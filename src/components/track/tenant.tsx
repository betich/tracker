import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { HostedTracker } from "@tracker/protocol";
import { config, storagePrefix } from "@config";
import { TRACKER_URL } from "./endpoint";

/**
 * Which tracker this page is showing, and how it should present itself.
 *
 * A self-hosted instance has exactly one, described at build time by
 * tracker.config.ts. The shared deployment serves many, so pages under
 * /t/<slug> resolve theirs at runtime — same bundle, different subject.
 */
export interface Tenant {
  /** null when this is the deployment's own tracker. */
  slug: string | null;
  subject: string;
  contacts: { phone: string | null; lineId: string | null };
  portrait: boolean;
  mapFallbackCenter: { lat: number; lon: number };
  /** Namespaces this tracker's likes in local storage. */
  storagePrefix: string;
}

const OWN_TENANT: Tenant = {
  slug: null,
  subject: config.subject,
  contacts: config.contacts,
  portrait: config.portrait,
  mapFallbackCenter: config.mapFallbackCenter,
  storagePrefix,
};

const TenantContext = createContext<Tenant>(OWN_TENANT);
export const useTenant = () => useContext(TenantContext);

/** `/t/<slug>` and `/t/<slug>/admin` — anything else is the deployment's own. */
export function slugFromPath(pathname = location.pathname): string | null {
  return /^\/t\/([0-9a-z]{4,32})(?:\/admin)?\/?$/.exec(pathname)?.[1] ?? null;
}

type State = { status: "ready"; tenant: Tenant } | { status: "loading" } | { status: "missing" };

/**
 * Resolves the tenant before rendering anything that depends on it. Without a
 * slug this settles synchronously, so a self-host never waits on a request.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() =>
    slugFromPath() === null ? { status: "ready", tenant: OWN_TENANT } : { status: "loading" },
  );

  useEffect(() => {
    const slug = slugFromPath();
    if (slug === null) return;

    let cancelled = false;
    fetch(`${TRACKER_URL}/api/tracker?slug=${encodeURIComponent(slug)}`)
      .then((response) => (response.ok ? (response.json() as Promise<HostedTracker>) : null))
      .then((found) => {
        if (cancelled) return;
        setState(
          found
            ? {
                status: "ready",
                tenant: {
                  slug: found.slug,
                  subject: found.subject,
                  contacts: { phone: found.phone, lineId: found.lineId },
                  portrait: config.portrait,
                  mapFallbackCenter: config.mapFallbackCenter,
                  storagePrefix: `t-${found.slug}`,
                },
              }
            : { status: "missing" },
        );
      })
      .catch(() => !cancelled && setState({ status: "missing" }));

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <Notice>Loading…</Notice>;
  if (state.status === "missing") {
    return (
      <Notice>
        No such tracker. It may have expired.
        <br />
        <a className="underline" href="/new">
          Make a new one
        </a>
      </Notice>
    );
  }

  return <TenantContext.Provider value={state.tenant}>{children}</TenantContext.Provider>;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-[var(--app-h,100dvh)] place-items-center bg-[var(--brand-ground)] px-8 text-center font-mono">
      {/* Element opacity, not a `/70` colour modifier: Tailwind cannot fold an
          alpha into a var() that already holds a full hsl() string. */}
      <p className="text-[11px] font-bold uppercase leading-relaxed tracking-[0.34em] text-[var(--brand-ink)] opacity-70">
        {children}
      </p>
    </div>
  );
}
