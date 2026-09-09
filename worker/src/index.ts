import { CLOSE, DEFAULT_TRACKER_ID, type ServerMessage } from "./protocol";
import { Tracker } from "./tracker";
import { Registry } from "./registry";

export { Tracker, Registry };

/** Where a hosted tracker's own pages live: /t/<slug> and /t/<slug>/admin. */
const HOSTED_PATH = /^\/t\/([0-9a-z]{4,32})(\/admin)?\/?$/;

export interface Env {
  TRACKER: DurableObjectNamespace<Tracker>;
  /** The built Astro site, served for everything that is not an API path. */
  ASSETS: Fetcher;
  /** Only bound on the shared deployment; absent when self-hosting one person. */
  REGISTRY?: DurableObjectNamespace<Registry>;
  /** "1" turns on /new and /t/<slug>. */
  MULTI_TENANT?: string;
  /** Which subject this deployment tracks. One Durable Object per id. */
  TRACKER_ID?: string;
  /** Extra origins allowed to reach the API. Same-origin never needs listing. */
  ALLOWED_ORIGINS?: string;
  /** Set at deploy time, or with `wrangler secret put ADMIN_KEY`. */
  ADMIN_KEY: string;
  /**
   * Unlocks /superadmin, the index of every hosted tracker. Unset by default,
   * and while it is unset the endpoint does not exist at all — a deployment
   * only grows that surface when its operator deliberately adds the secret.
   */
  SUPERADMIN_KEY?: string;
}

/** The paths `run_worker_first` routes here; everything else is a static asset. */
const API_PATHS = new Set([
  "/ws",
  "/state",
  "/photo",
  "/api/create",
  "/api/tracker",
  "/api/import",
  "/api/trackers",
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hosted = hostedTracker(env) ? HOSTED_PATH.exec(url.pathname) : null;

    /*
     * Every hosted tracker shares two built pages; the slug lives in the URL
     * and the client reads it at runtime. Serving the same HTML for any slug is
     * what lets a static build back an unbounded number of trackers.
     */
    if (hosted) {
      // The pretty path, not /index.html: the asset layer redirects .html URLs
      // to their canonical form, and a redirect would strip the slug out of the
      // address bar — leaving the page with nothing to resolve.
      const page = hosted[2] ? "/t/admin/" : "/t/";
      return env.ASSETS.fetch(new Request(new URL(page, url.origin), request));
    }

    if (!API_PATHS.has(url.pathname)) return env.ASSETS.fetch(request);

    const origin = request.headers.get("Origin");
    const allowed = isAllowedOrigin(origin, url, env);
    const cors = corsHeaders(origin, allowed);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // The admin key is the real gate, but pinning the origin keeps another site
    // from opening sockets with a key it scraped from a shared link.
    if (origin && !allowed) {
      return new Response("forbidden origin", { status: 403 });
    }

    const registry = hostedTracker(env);

    if (url.pathname === "/api/create") {
      if (!registry) return new Response("not enabled", { status: 404, headers: cors });
      if (request.method !== "POST") return new Response("use POST", { status: 405, headers: cors });

      let body: {
        subject?: string;
        phone?: string | null;
        lineId?: string | null;
        color?: string | null;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return new Response("bad request", { status: 400, headers: cors });
      }

      const made = await registry.create({
        subject: body.subject ?? "",
        phone: body.phone ?? null,
        lineId: body.lineId ?? null,
        color: body.color ?? null,
        /*
         * Cloudflare overwrites this at the edge, so it cannot be spoofed in
         * production. `wrangler dev` supplies one too, which is why local test
         * runs send their own to get a bucket of their own rather than sharing
         * the developer's. Null is only reachable on some other runtime.
         */
        who: request.headers.get("CF-Connecting-IP"),
      });
      const status = "error" in made ? 429 : 200;
      return Response.json(made, { status, headers: { ...cors, "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/api/tracker") {
      if (!registry) return new Response("not enabled", { status: 404, headers: cors });
      const slug = url.searchParams.get("slug") ?? "";
      const found = await registry.lookup(slug);
      if (!found) return new Response("not found", { status: 404, headers: cors });
      registry.touch(slug);
      return Response.json(found, { headers: { ...cors, "Cache-Control": "no-store" } });
    }

    /*
     * The superadmin index: every tracker this deployment has minted. Gated on
     * its own secret rather than ADMIN_KEY, so the key that drives one tracker
     * can never enumerate the rest — and 404s while the secret is unset, which
     * keeps the surface off for every deployment that never asked for it.
     */
    if (url.pathname === "/api/trackers") {
      if (!registry || !env.SUPERADMIN_KEY) {
        return new Response("not enabled", { status: 404, headers: cors });
      }
      if (!(await secretMatches(url.searchParams.get("key"), env.SUPERADMIN_KEY))) {
        return new Response("unauthorized", { status: 401, headers: cors });
      }
      return Response.json(await registry.list(), {
        headers: { ...cors, "Cache-Control": "no-store" },
      });
    }

    // Deliberately not `id`: /photo already uses that for the photo's own id.
    const trackerId = url.searchParams.get("tracker") || env.TRACKER_ID || DEFAULT_TRACKER_ID;
    const stub = env.TRACKER.getByName(trackerId);

    /*
     * Restore a timeline recorded elsewhere — moving between deployments, or
     * putting back a backup. Admin-only, and scoped to the tracker the key
     * controls, so it is no more privileged than posting.
     */
    if (url.pathname === "/api/import") {
      if (request.method !== "POST") return new Response("use POST", { status: 405, headers: cors });
      if (!(await isAdmin(url, trackerId, env))) {
        return new Response("unauthorized", { status: 401, headers: cors });
      }

      let body: { updates?: unknown; fix?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return new Response("bad request", { status: 400, headers: cors });
      }
      if (!Array.isArray(body.updates)) {
        return new Response("expected updates[]", { status: 400, headers: cors });
      }

      const result = await stub.importState(
        body.updates as Parameters<Tracker["importState"]>[0],
        (body.fix ?? null) as Parameters<Tracker["importState"]>[1],
      );
      return Response.json(result, { headers: { ...cors, "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      if (url.searchParams.get("role") === "admin" && !(await isAdmin(url, trackerId, env))) {
        return refuseUpgrade();
      }
      if (registry && url.searchParams.has("tracker")) registry.touch(trackerId);
      return stub.fetch(request);
    }

    // Photo bodies are served here rather than pushed down the socket: ids are
    // immutable, so each one caches forever and history costs nothing to rejoin.
    if (url.pathname === "/photo") {
      const id = url.searchParams.get("id");
      if (!id) return new Response("missing id", { status: 400, headers: cors });

      const dataUrl = await stub.photo(id);
      if (!dataUrl) return new Response("not found", { status: 404, headers: cors });

      const [meta, base64] = dataUrl.split(",", 2);
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      return new Response(bytes, {
        headers: {
          ...cors,
          "Content-Type": /data:([^;]+)/.exec(meta)?.[1] ?? "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    return Response.json(await stub.snapshot(), {
      headers: { ...cors, "Cache-Control": "no-store" },
    });
  },
} satisfies ExportedHandler<Env>;

/**
 * Refuse an admin upgrade over the socket rather than with a 401, because a
 * browser surfaces nothing but "connection failed" for a non-101 response.
 */
function refuseUpgrade(): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].send(JSON.stringify({ t: "denied", reason: "auth" } satisfies ServerMessage));
  pair[1].close(CLOSE.auth, "auth");
  return new Response(null, { status: 101, webSocket: pair[0] });
}

/** The registry namespace, or null when this deployment serves one person. */
function hostedTracker(env: Env): DurableObjectStub<Registry> | null {
  if (env.MULTI_TENANT !== "1" || !env.REGISTRY) return null;
  return env.REGISTRY.getByName("registry");
}

/**
 * A hosted tracker is controlled by its own key, held hashed in the registry.
 * The instance's ADMIN_KEY governs only the tracker this deployment was
 * configured for, so one person's key can never drive somebody else's page.
 */
async function isAdmin(url: URL, trackerId: string, env: Env): Promise<boolean> {
  const supplied = url.searchParams.get("key");
  if (!supplied) return false;

  const registry = hostedTracker(env);
  if (registry && url.searchParams.has("tracker") && trackerId !== env.TRACKER_ID) {
    return registry.verify(trackerId, supplied);
  }

  return secretMatches(supplied, env.ADMIN_KEY);
}

/** Constant-time compare, on digests so the lengths always match. */
async function secretMatches(supplied: string | null, expected: string | undefined): Promise<boolean> {
  if (!supplied || !expected) return false;
  const digest = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(supplied), digest(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * The page and the API are served by the same Worker, so the common case is a
 * request from our own origin — which no deployment should have to configure,
 * since nobody knows the hostname until it exists. Anything else has to be
 * listed explicitly.
 */
function isAllowedOrigin(origin: string | null, url: URL, env: Env): boolean {
  if (!origin) return true; // Non-browser clients send none.
  if (origin === url.origin) return true;

  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

function corsHeaders(origin: string | null, allowed: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    Vary: "Origin",
  };
  if (origin && allowed) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
