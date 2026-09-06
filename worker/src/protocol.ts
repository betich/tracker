/**
 * Wire protocol shared by the worker, /track and /track/admin.
 *
 * The frontend imports this file through the `@tracker/*` tsconfig path, so it
 * is the single source of truth for both ends of the socket. Keep it free of
 * runtime dependencies — it has to be loadable from a browser bundle and from
 * workerd alike.
 */

/** A position reading taken by the admin device. */
export interface Fix {
  /** Degrees, WGS84. */
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres, as reported by the Geolocation API. */
  acc: number | null;
  /** Ground speed in m/s, where the device provides it. */
  spd: number | null;
  /** Direction of travel in degrees clockwise from true north. */
  hdg: number | null;
  /** When the fix was taken, in epoch milliseconds (server clock). */
  ts: number;
}

/**
 * A status update posted from the admin device. The photo itself is *not* part
 * of this shape: it is fetched separately from `GET /photo`, so a viewer
 * joining mid-journey doesn't get a megabyte of history pushed down the socket,
 * and so the browser can cache each image by its immutable id.
 */
export interface Update {
  id: string;
  text: string;
  hasPhoto: boolean;
  ts: number;
  likes: number;
}

/** Messages the admin sends up the socket. */
export type ClientMessage =
  | { t: "fix"; fix: Omit<Fix, "ts"> }
  | { t: "post"; text: string; photo: string | null }
  /**
   * Anyone may like — it is the one thing viewers can write. `viewer` is a
   * throwaway id the browser makes up for itself, so a like is deduplicated
   * per device without anybody signing in.
   */
  | { t: "like"; id: string; viewer: string; on: boolean }
  | { t: "ping" };

/** Messages the worker pushes down to every socket. */
export type ServerMessage =
  /** Sent once on connect, before any state. */
  | { t: "hello"; role: "admin" | "viewer" }
  /** The full picture. Sent on connect and on every change. */
  | { t: "state"; tracking: boolean; viewers: number; fix: Fix | null }
  /** The whole timeline, newest first. Sent once on connect. */
  | { t: "updates"; updates: Update[] }
  /** A single new update, pushed to everyone the moment it is posted. */
  | { t: "update"; update: Update }
  /** A like count changed. Sent on its own so a tally costs almost nothing. */
  | { t: "likes"; id: string; likes: number }
  /** The connection was refused; the socket closes right after. */
  | { t: "denied"; reason: DeniedReason };

export type DeniedReason =
  /** Wrong or missing admin key. */
  | "auth"
  /** Another admin session already holds the tracker. */
  | "locked"
  /** This admin session was displaced by a newer one. */
  | "superseded";

/** WebSocket close codes. The 4000–4999 range is reserved for applications. */
export const CLOSE = {
  auth: 4003,
  locked: 4001,
  superseded: 4002,
} as const;

/**
 * The tracked subject. One Durable Object instance per id, so pointing at a
 * different id (`?tracker=…`) gives a completely separate tracker and timeline
 * — which is how smoke tests stay out of the live one.
 */
export const DEFAULT_TRACKER_ID = "bundit-live";

/** Longest status text accepted, in characters. */
export const MAX_UPDATE_TEXT = 280;

/**
 * Largest accepted photo, as data-URL length. Workers cap a WebSocket frame at
 * 1 MiB, so the admin downscales below this before sending.
 */
export const MAX_PHOTO_CHARS = 900_000;

/** How many updates are kept; older ones are dropped as new ones arrive. */
export const UPDATE_HISTORY = 50;

/** Longest accepted viewer id. Long enough for a UUID, short enough to bound the table. */
export const MAX_VIEWER_ID = 64;
