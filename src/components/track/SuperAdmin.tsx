import { useEffect, useState } from "react";
import type { TrackerSummary } from "@tracker/protocol";
import { config } from "@config";
import { TRACKER_URL } from "./endpoint";
import { paletteVars } from "./palette";
import "./track.css";

/** Idle time after which the registry drops a tracker; mirrors registry.ts. */
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Not geo.ts's formatAge, which tops out in hours because a live tracker is
 * never stale for longer. This index spans a week, where "64h" reads worse
 * than "3d".
 */
function since(ms: number): string {
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < DAY_MS) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / DAY_MS)}d ago`;
}

const GROUND = 0.12;

type State =
  | { status: "loading" }
  | { status: "ready"; rows: TrackerSummary[] }
  | { status: "denied" }
  | { status: "off" }
  | { status: "error" };

/**
 * The index of every tracker this deployment has minted. Gated on SUPERADMIN_KEY,
 * which is read from `?key=` the same way the per-tracker admin pages read theirs
 * — the server is the only thing that decides whether it is right.
 */
export default function SuperAdmin() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const key = new URLSearchParams(location.search).get("key") ?? "";
    let cancelled = false;

    fetch(`${TRACKER_URL}/api/trackers?key=${encodeURIComponent(key)}`)
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) return setState({ status: "denied" });
        if (response.status === 404) return setState({ status: "off" });
        if (!response.ok) return setState({ status: "error" });
        setState({ status: "ready", rows: (await response.json()) as TrackerSummary[] });
      })
      .catch(() => !cancelled && setState({ status: "error" }));

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="track relative flex min-h-[var(--app-h,100dvh)] flex-col font-mono"
      style={paletteVars(GROUND) as React.CSSProperties}
    >
      <header className="shrink-0 px-5 pb-4 pt-[max(0.85rem,env(safe-area-inset-top))]">
        <h1 className="text-[clamp(1.75rem,7vw,2.5rem)] font-bold leading-none tracking-tight">
          Trackers
        </h1>
        <p className="track-label mt-2 text-[10px] font-medium text-[var(--muted)]">
          {state.status === "ready"
            ? `${state.rows.length} live · dropped a week after last opened`
            : " "}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {state.status === "loading" ? (
          <Notice>Loading…</Notice>
        ) : state.status === "denied" ? (
          <Notice>Wrong or missing key. Open this page with ?key=…</Notice>
        ) : state.status === "off" ? (
          <Notice>Not enabled. Set the SUPERADMIN_KEY secret to switch it on.</Notice>
        ) : state.status === "error" ? (
          <Notice>Couldn't reach the server.</Notice>
        ) : state.rows.length === 0 ? (
          <Notice>No trackers yet.</Notice>
        ) : (
          <ul className="space-y-2.5">
            {state.rows.map((row) => (
              <Row key={row.slug} row={row} now={now} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ row, now }: { row: TrackerSummary; now: number }) {
  const expiresIn = row.usedAt + EXPIRY_MS - now;

  return (
    <li className="flex items-center gap-4 rounded-2xl border border-[var(--hairline)] bg-white/[0.06] px-4 py-3.5">
      {/* The tracker's own colour, so the list is scannable by it. */}
      <span
        className="h-8 w-8 shrink-0 rounded-full border border-[var(--hairline)]"
        // A null colour means the tracker wears the deployment's own.
        style={{ background: row.color ?? config.primaryColor }}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold leading-tight">{row.subject}</p>
        <p className="track-label mt-1 text-[9px] font-medium text-[var(--muted)]">
          /t/{row.slug}
          {row.hasPhone && " · phone"}
          {row.hasLine && " · line"}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className="track-label text-[9px] font-bold text-[var(--muted)]">
          {since(now - row.usedAt)}
        </p>
        <p
          className="track-label mt-1 text-[9px] font-medium"
          style={{ color: expiresIn < DAY_MS ? "var(--stale)" : "var(--muted)" }}
        >
          {expiresIn > 0 ? `${Math.ceil(expiresIn / DAY_MS)}d left` : "expiring"}
        </p>
      </div>

      <a
        href={`/t/${row.slug}`}
        className="track-label shrink-0 rounded-full border border-[var(--hairline)] px-3.5 py-2 text-[9px] font-bold"
      >
        open
      </a>
    </li>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="track-label px-2 py-10 text-center text-[10px] font-medium leading-relaxed text-[var(--muted)]">
      {children}
    </p>
  );
}
