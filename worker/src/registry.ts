import { DurableObject } from "cloudflare:workers";
import { MAX_UPDATE_TEXT, type HostedTracker } from "./protocol";
import type { Env } from "./index";

/** Idle time after which a hosted tracker and everything in it is dropped. */
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
/** How often the sweep runs. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Per-address creation budget, so one visitor cannot fill the account. */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 5;

/** No vowels and no look-alikes, so a slug read aloud survives the journey. */
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const SLUG_LENGTH = 6;

export interface Created {
  slug: string;
  /** Returned exactly once, at creation. Only its hash is kept. */
  adminKey: string;
}

/**
 * The index of hosted trackers, for the shared deployment. One row per tracker:
 * who it is, how to reach them, and the hash of the key that controls it.
 *
 * A self-hosted instance never instantiates this — it serves a single tracker
 * from TRACKER_ID and the ADMIN_KEY secret, and none of this exists.
 */
export class Registry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS trackers (
          slug TEXT PRIMARY KEY,
          subject TEXT NOT NULL,
          phone TEXT,
          line_id TEXT,
          key_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          used_at INTEGER NOT NULL
        )
      `);
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_trackers_used ON trackers(used_at)");
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS creations (
          at INTEGER NOT NULL,
          who TEXT NOT NULL
        )
      `);
      if ((await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
      }
    });
  }

  /** Mint a tracker. Returns the admin key once; only its hash is stored. */
  async create(input: {
    subject: string;
    phone: string | null;
    lineId: string | null;
    who: string;
  }): Promise<Created | { error: string }> {
    const subject = (input.subject ?? "").trim().slice(0, 40);
    if (!subject) return { error: "Give the tracker a name." };

    const since = Date.now() - RATE_WINDOW_MS;
    this.ctx.storage.sql.exec("DELETE FROM creations WHERE at < ?", since);
    const recent = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM creations WHERE who = ?", input.who)
      .one().n;
    if (recent >= RATE_LIMIT) return { error: "That's a lot of trackers. Try again later." };

    let slug = "";
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = randomSlug();
      const taken = this.ctx.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM trackers WHERE slug = ?", candidate)
        .one().n;
      if (taken === 0) {
        slug = candidate;
        break;
      }
    }
    if (!slug) return { error: "Couldn't allocate a name. Try again." };

    const adminKey = randomKey();
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO trackers (slug, subject, phone, line_id, key_hash, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      slug,
      subject,
      clean(input.phone),
      clean(input.lineId),
      await sha256(adminKey),
      now,
      now,
    );
    this.ctx.storage.sql.exec("INSERT INTO creations (at, who) VALUES (?, ?)", now, input.who);

    return { slug, adminKey };
  }

  /** What a page needs to render this tracker. Null when there is no such slug. */
  lookup(slug: string): HostedTracker | null {
    const rows = this.ctx.storage.sql
      .exec<{ slug: string; subject: string; phone: string | null; line_id: string | null }>(
        "SELECT slug, subject, phone, line_id FROM trackers WHERE slug = ?",
        slug,
      )
      .toArray();
    const row = rows[0];
    if (!row) return null;
    return { slug: row.slug, subject: row.subject, phone: row.phone, lineId: row.line_id };
  }

  /** True when this key controls this tracker. */
  async verify(slug: string, key: string): Promise<boolean> {
    const rows = this.ctx.storage.sql
      .exec<{ key_hash: string }>("SELECT key_hash FROM trackers WHERE slug = ?", slug)
      .toArray();
    if (!rows[0]) return false;
    return timingSafeEqualHex(rows[0].key_hash, await sha256(key));
  }

  /** Keep a tracker alive. Called when someone actually connects to it. */
  touch(slug: string): void {
    this.ctx.storage.sql.exec("UPDATE trackers SET used_at = ? WHERE slug = ?", Date.now(), slug);
  }

  /** Drop trackers nobody has opened in a week, and everything they held. */
  override async alarm(): Promise<void> {
    const cutoff = Date.now() - EXPIRY_MS;
    const stale = this.ctx.storage.sql
      .exec<{ slug: string }>("SELECT slug FROM trackers WHERE used_at < ?", cutoff)
      .toArray();

    for (const { slug } of stale) {
      try {
        await this.env.TRACKER.getByName(slug).purge();
      } catch {
        // The object may never have been written to; the row still goes.
      }
      this.ctx.storage.sql.exec("DELETE FROM trackers WHERE slug = ?", slug);
    }

    await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }
}

const clean = (value: string | null) => {
  const trimmed = (value ?? "").trim().slice(0, MAX_UPDATE_TEXT);
  return trimmed || null;
};

function pick(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

const randomSlug = () => pick(SLUG_ALPHABET, SLUG_LENGTH);
const randomKey = () => pick("0123456789abcdef", 32);

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Both sides are fixed-length hex digests, so this is a safe constant-time compare. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encode = (value: string) => new TextEncoder().encode(value);
  return crypto.subtle.timingSafeEqual(encode(a), encode(b));
}
