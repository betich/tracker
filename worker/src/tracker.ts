import { DurableObject } from "cloudflare:workers";
import {
  CLOSE,
  MAX_PHOTO_CHARS,
  MAX_UPDATE_TEXT,
  MAX_VIEWER_ID,
  UPDATE_HISTORY,
  type ClientMessage,
  type Fix,
  type ServerMessage,
  type Update,
} from "./protocol";
import type { Env } from "./index";

/** Sockets are tagged at accept time so we can count each role without deserialising. */
const ADMIN = "admin";
const VIEWER = "viewer";

/**
 * One instance per tracked subject. Holds the last known fix and, at most, one
 * live admin session — the device doing the tracking. Everyone else is a viewer
 * and gets pushed the state whenever it changes.
 *
 * Sockets use the hibernation API, so an idle tracker costs nothing while still
 * holding its connections open.
 */
export class Tracker extends DurableObject<Env> {
  /** Mirror of the stored fix, so broadcasts don't hit storage. */
  private fix: Fix | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      // Photos go in SQLite rather than the KV API: a downscaled JPEG data URL
      // is well past the 128 KiB value limit, but sits comfortably in a row.
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS updates (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          photo TEXT,
          ts INTEGER NOT NULL
        )
      `);
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_updates_ts ON updates(ts)");
      // One row per (update, device). The primary key is the deduplication —
      // liking twice from the same browser is a no-op, no accounts involved.
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS likes (
          update_id TEXT NOT NULL,
          viewer TEXT NOT NULL,
          PRIMARY KEY (update_id, viewer)
        )
      `);
      this.fix = (await ctx.storage.get<Fix>("fix")) ?? null;
    });
  }

  /** The timeline, newest first, without the photo bodies. */
  private timeline(): Update[] {
    return this.ctx.storage.sql
      .exec<{ id: string; text: string; hasPhoto: number; ts: number; likes: number }>(
        `SELECT u.id, u.text, (u.photo IS NOT NULL) AS hasPhoto, u.ts,
                (SELECT COUNT(*) FROM likes WHERE likes.update_id = u.id) AS likes
         FROM updates u ORDER BY u.ts DESC LIMIT ?`,
        UPDATE_HISTORY,
      )
      .toArray()
      .map(({ id, text, hasPhoto, ts, likes }) => ({ id, text, hasPhoto: hasPhoto === 1, ts, likes }));
  }

  /** Add or remove one device's like, then tell everyone the new tally. */
  private like(id: string, viewer: string, on: boolean): void {
    if (typeof id !== "string" || typeof viewer !== "string") return;
    if (!viewer || viewer.length > MAX_VIEWER_ID) return;

    const exists = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM updates WHERE id = ?", id)
      .one().n;
    if (exists === 0) return;

    if (on) {
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO likes (update_id, viewer) VALUES (?, ?)",
        id,
        viewer,
      );
    } else {
      this.ctx.storage.sql.exec("DELETE FROM likes WHERE update_id = ? AND viewer = ?", id, viewer);
    }

    const likes = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM likes WHERE update_id = ?", id)
      .one().n;

    for (const ws of this.ctx.getWebSockets()) send(ws, { t: "likes", id, likes });
  }

  /** One photo body, as its stored data URL. Served over HTTP, never the socket. */
  photo(id: string): string | null {
    const rows = this.ctx.storage.sql
      .exec<{ photo: string | null }>("SELECT photo FROM updates WHERE id = ?", id)
      .toArray();
    return rows[0]?.photo ?? null;
  }

  /**
   * WebSocket upgrade. This has to be a fetch handler rather than an RPC method
   * — RPC cannot return a 101.
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const wantsAdmin = url.searchParams.get("role") === ADMIN;
    const takeover = url.searchParams.get("takeover") === "1";

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    if (wantsAdmin) {
      const incumbents = this.ctx.getWebSockets(ADMIN);

      if (incumbents.length > 0 && !takeover) {
        return this.refuse(client, server, "locked", CLOSE.locked);
      }

      // A takeover evicts whoever holds the tracker, so the new phone can pick
      // up without waiting for a stale socket to time out.
      for (const incumbent of incumbents) {
        send(incumbent, { t: "denied", reason: "superseded" });
        incumbent.close(CLOSE.superseded, "superseded");
      }
    }

    this.ctx.acceptWebSocket(server, [wantsAdmin ? ADMIN : VIEWER]);
    send(server, { t: "hello", role: wantsAdmin ? "admin" : "viewer" });
    send(server, { t: "updates", updates: this.timeline() });

    // A new admin flips `tracking`, and any join changes the viewer count, so
    // everyone needs the fresh picture — not just the socket that arrived.
    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Record a status update and push it to everyone watching. */
  private post(text: string, photo: string | null): void {
    const trimmed = (text ?? "").trim().slice(0, MAX_UPDATE_TEXT);
    const image = typeof photo === "string" && photo.length <= MAX_PHOTO_CHARS ? photo : null;
    if (!trimmed && !image) return;

    const update: Update = {
      id: crypto.randomUUID(),
      text: trimmed,
      hasPhoto: image !== null,
      ts: Date.now(),
      likes: 0,
    };

    // No await between the two statements, so they commit as one transaction.
    this.ctx.storage.sql.exec(
      "INSERT INTO updates (id, text, photo, ts) VALUES (?, ?, ?, ?)",
      update.id,
      update.text,
      image,
      update.ts,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM updates WHERE id NOT IN (SELECT id FROM updates ORDER BY ts DESC LIMIT ?)",
      UPDATE_HISTORY,
    );
    // Don't let likes outlive the update they belong to.
    this.ctx.storage.sql.exec("DELETE FROM likes WHERE update_id NOT IN (SELECT id FROM updates)");

    for (const ws of this.ctx.getWebSockets()) send(ws, { t: "update", update });
  }

  /** Read-only snapshot, for clients that just want a poll rather than a socket. */
  snapshot(): Extract<ServerMessage, { t: "state" }> {
    return this.state() as Extract<ServerMessage, { t: "state" }>;
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    // Liking is the one thing a viewer may write.
    if (message.t === "like") {
      this.like(message.id, message.viewer, message.on !== false);
      return;
    }

    if (!this.ctx.getTags(ws).includes(ADMIN)) return; // Otherwise viewers are read-only.

    if (message.t === "ping") {
      send(ws, this.state());
      return;
    }

    if (message.t === "post") {
      this.post(message.text, message.photo);
      return;
    }

    if (message.t !== "fix" || !isPlausible(message.fix)) return;

    // Stamp with the server clock: viewers compare it against their own to age
    // the fix, and phone clocks drift.
    const fix: Fix = { ...message.fix, ts: Date.now() };
    await this.ctx.storage.put("fix", fix);
    this.fix = fix;
    this.broadcastState();
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.broadcastState(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastState(ws);
  }

  /** Current state as it looks to a viewer. */
  private state(departing?: WebSocket): ServerMessage {
    const live = (tag: string) => this.ctx.getWebSockets(tag).filter((ws) => ws !== departing).length;
    return { t: "state", tracking: live(ADMIN) > 0, viewers: live(VIEWER), fix: this.fix };
  }

  /**
   * Push state to every socket. `departing` is the socket being closed, which
   * may still be listed while its close handler runs.
   */
  private broadcastState(departing?: WebSocket): void {
    const message = this.state(departing);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== departing) send(ws, message);
    }
  }

  /** Accept just long enough to explain why, so the client can show a reason. */
  private refuse(client: WebSocket, server: WebSocket, reason: "locked", code: number): Response {
    server.accept();
    send(server, { t: "denied", reason });
    server.close(code, reason);
    return new Response(null, { status: 101, webSocket: client });
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Socket already gone; the close handler will tidy up.
  }
}

/** Reject nonsense before it reaches storage and every viewer's compass. */
function isPlausible(fix: Omit<Fix, "ts">): boolean {
  const finite = (n: number | null) => n === null || Number.isFinite(n);
  return (
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.lon) &&
    Math.abs(fix.lat) <= 90 &&
    Math.abs(fix.lon) <= 180 &&
    finite(fix.acc) &&
    finite(fix.spd) &&
    finite(fix.hdg)
  );
}
