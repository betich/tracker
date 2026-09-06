/**
 * Where the API lives.
 *
 * In production the Worker serves both the pages and the API, so these are
 * relative: whatever host the page came from is the host to talk to, which
 * means a deployment never has to be told its own URL. In development the two
 * run separately — `astro dev` on 4321, `wrangler dev` on 8787 — so it points
 * across. Override with PUBLIC_TRACKER_URL to host the frontend elsewhere.
 */
const configured = import.meta.env.PUBLIC_TRACKER_URL as string | undefined;

export const TRACKER_URL = (
  configured ?? (import.meta.env.DEV ? "http://localhost:8787" : "")
).replace(/\/$/, "");

/** Where to fetch an update's photo. Immutable ids, so the browser caches it. */
export function photoUrl(id: string): string {
  return `${TRACKER_URL}/photo?id=${encodeURIComponent(id)}`;
}

/** Websocket URL for a role, e.g. wss://…/ws?role=admin&key=… */
export function socketUrl(params: Record<string, string>): string {
  // Relative in production, so resolve against the page we were served from.
  const url = new URL(`${TRACKER_URL}/ws`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
