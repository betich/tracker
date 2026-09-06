import { useCallback, useEffect, useRef, useState } from "react";
import Timeline from "./Timeline";
import SpinnyMark from "./SpinnyMark";
import PinPicker from "./PinPicker";
import { useTracker } from "./useTracker";
import { useDeviceHeading, useGeolocation } from "./sensors";
import { toDataUrl } from "./photo";
import { formatAge, type LatLon } from "./geo";
import { groundColor } from "./proximity";
import { useTenant } from "./tenant";
import { MAX_UPDATE_TEXT, type Fix } from "@tracker/protocol";
import "./track.css";

/**
 * Resend cadence. The position often doesn't change — pinned, or standing still
 * — but viewers age the last fix, so a quiet tracker must still say it's here.
 */
const HEARTBEAT_MS = 8_000;
/** Ground brightness while broadcasting, and while idle. */
const LIVE_GROUND = 0.72;
const IDLE_GROUND = 0.06;

type Tab = "broadcast" | "updates";

/**
 * The tracking device. Opening the page claims nothing — the socket is only
 * dialled on "start broadcasting", because connecting is what takes the lock.
 * Posting rides the same socket, so only the holder can add to the timeline.
 */
export default function AdminApp() {
  const { slug, subject, portrait } = useTenant();
  const [key] = useState(() => new URLSearchParams(location.search).get("key") ?? "");
  const [broadcasting, setBroadcasting] = useState(false);
  const [takeover, setTakeover] = useState(false);
  const [tab, setTab] = useState<Tab>("broadcast");
  /** A hand-placed spot that overrides GPS until cleared. */
  const [pinned, setPinned] = useState<LatLon | null>(null);
  const [picking, setPicking] = useState(false);

  const tracker = useTracker(
    {
      role: "admin",
      key,
      ...(takeover ? { takeover: "1" } : {}),
      // A hosted tracker is addressed by slug and checked against its own key.
      ...(slug ? { tracker: slug } : {}),
    },
    broadcasting,
  );
  const me = useGeolocation();
  // Only for the footer mark. iOS won't hand this over without a gesture and
  // there's no prompt on this screen, so there he simply stays put.
  const heading = useDeviceHeading();

  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // A refusal means we never got the lock, so stop pretending we're broadcasting.
  useEffect(() => {
    if (tracker.denied) setBroadcasting(false);
  }, [tracker.denied]);

  const source = pinned ?? me.coords;

  /**
   * The reading as it stands right now, in a ref so a final flush can send it
   * without depending on a closure that may be a render behind.
   */
  const latest = useRef<Omit<Fix, "ts"> | null>(null);
  useEffect(() => {
    latest.current = pinned
      ? // A pinned spot has no measurement error to report; a null accuracy is
        // what tells viewers it was placed by hand.
        { lat: pinned.lat, lon: pinned.lon, acc: null, spd: null, hdg: null }
      : me.coords
        ? { lat: me.coords.lat, lon: me.coords.lon, acc: me.accuracy, spd: me.speed, hdg: me.heading }
        : null;
  });

  const push = useCallback(() => {
    const fix = latest.current;
    if (!fix) return;
    tracker.send({ t: "fix", fix });
    setSentAt(Date.now());
  }, [tracker.send]);

  // One sender for both sources: pushes immediately whenever the position or
  // its source changes, then keeps a heartbeat going so the fix stays fresh.
  useEffect(() => {
    if (!broadcasting || tracker.status !== "open" || !source) return;
    push();
    const id = setInterval(push, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [broadcasting, tracker.status, pinned, source?.lat, source?.lon, me.accuracy, push]);

  /*
   * Send one last reading before the session ends. Without this, whoever is
   * watching is left holding whatever the heartbeat happened to send — up to
   * HEARTBEAT_MS out of date, and on a moving device that is a whole street.
   *
   * pagehide is the event that actually fires when a phone browser is closed or
   * swiped away; visibilitychange covers backgrounding, where iOS may freeze
   * the page and never deliver anything else.
   */
  useEffect(() => {
    if (!broadcasting || tracker.status !== "open") return;

    const flush = () => push();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [broadcasting, tracker.status, push]);

  const start = (withTakeover: boolean) => {
    setTakeover(withTakeover);
    setBroadcasting(true);
    if (tracker.denied) tracker.retry();
  };

  const live = broadcasting && tracker.status === "open";

  return (
    <div
      className="track flex flex-col font-mono"
      style={{ "--ground": groundColor(live ? LIVE_GROUND : IDLE_GROUND) } as React.CSSProperties}
    >
      <header className="flex shrink-0 items-center justify-between px-5 pb-1 pt-[max(0.85rem,env(safe-area-inset-top))]">
        <span className="track-label text-[11px] font-bold">{subject} · admin</span>
        <span className="track-label text-[10px] font-bold text-[var(--muted)]">
          {tracker.viewers} watching
        </span>
      </header>

      {picking ? (
        <PinPicker
          start={pinned ?? me.coords}
          onSave={(point) => {
            setPinned(point);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : tab === "broadcast" ? (
        <>
          <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
            <p className="track-figure font-bold" style={{ fontSize: "clamp(3rem, 20vw, 8rem)" }}>
              {live ? "ON AIR" : tracker.denied ? "BLOCKED" : "OFF"}
            </p>

            <p className="track-label max-w-xs text-[11px] font-medium leading-relaxed text-[var(--muted)]">
              <Explanation
            tracker={tracker}
            me={me}
            broadcasting={broadcasting}
            hasKey={Boolean(key)}
            pinned={pinned !== null}
          />
            </p>

            <dl className="track-label grid w-full max-w-xs grid-cols-2 gap-y-3 text-left text-[10px] font-medium text-[var(--muted)]">
              <Row label="Source" value={pinned ? "Pinned by hand" : "GPS"} />
              <Row label="Latitude" value={source ? source.lat.toFixed(6) : "—"} />
              <Row label="Longitude" value={source ? source.lon.toFixed(6) : "—"} />
              <Row label="Accuracy" value={pinned ? "exact" : me.accuracy ? `±${Math.round(me.accuracy)} m` : "—"} />
              <Row label="Last sent" value={sentAt ? formatAge(now - sentAt) : "—"} />
            </dl>
          </main>

          <div className="shrink-0 space-y-3 px-5 pb-4">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="track-label flex-1 rounded-2xl border border-[var(--hairline)] py-5 text-[10px] font-bold"
                style={pinned ? { color: "var(--beacon)", borderColor: "var(--beacon)" } : undefined}
              >
                {pinned ? "Move pin" : "Pin exact spot"}
              </button>
              {pinned && (
                <button
                  type="button"
                  onClick={() => setPinned(null)}
                  className="track-label flex-1 rounded-2xl border border-[var(--hairline)] py-5 text-[10px] font-bold text-[var(--muted)]"
                >
                  Back to GPS
                </button>
              )}
            </div>

            {tracker.denied === "locked" || tracker.denied === "superseded" ? (
              <Button onClick={() => start(true)}>Take over</Button>
            ) : broadcasting ? (
              <Button
                onClick={() => {
                  // Flush first: the socket closes as soon as `broadcasting`
                  // flips, and the frame is already queued by then.
                  push();
                  setBroadcasting(false);
                }}
                muted
              >
                Stop
              </Button>
            ) : (
              <Button onClick={() => start(false)} disabled={!key}>
                Start broadcasting
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <Composer live={live} send={tracker.send} />
          <div className="min-h-0 flex-1">
            <Timeline updates={tracker.updates} now={now} send={tracker.send} />
          </div>
        </div>
      )}

      {portrait && <SpinnyMark headingRef={heading.live} />}

      <nav className="grid shrink-0 grid-cols-2 border-t border-[var(--hairline)] pb-[env(safe-area-inset-bottom)]">
        {(["broadcast", "updates"] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-current={tab === name}
            className={`track-label py-6 text-[11px] font-bold transition-colors ${
              tab === name ? "bg-white/10 text-[var(--ink)]" : "text-[var(--muted)]"
            }`}
          >
            {name}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Text plus an optional photo, posted down the admin's own socket. */
function Composer({ live, send }: { live: boolean; send: ReturnType<typeof useTracker>["send"] }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setPhoto(await toDataUrl(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't read that photo.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = ""; // Allow re-picking the same file.
    }
  };

  const post = () => {
    if (!live || busy || (!text.trim() && !photo)) return;
    send({ t: "post", text: text.trim(), photo });
    setText("");
    setPhoto(null);
  };

  return (
    <div className="shrink-0 px-4">
      <div className="flex flex-col gap-3 rounded-3xl border border-[var(--hairline)] bg-white/[0.07] p-4">
        {photo && (
          <div className="relative">
            <img src={photo} alt="" className="h-40 w-full rounded-2xl object-cover" />
            <button
              type="button"
              onClick={() => setPhoto(null)}
              className="track-label absolute right-3 top-3 rounded-full bg-black/60 px-4 py-2 text-[9px] font-bold"
            >
              Remove
            </button>
          </div>
        )}

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_UPDATE_TEXT))}
          placeholder="What's happening?"
          rows={2}
          disabled={!live}
          className="resize-none bg-transparent font-bold leading-[1.05] placeholder:text-[var(--muted)] focus:outline-none disabled:opacity-40"
          style={{ fontSize: "clamp(1.5rem, 7vw, 2.5rem)", letterSpacing: "-0.02em" }}
        />

        <div className="flex items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => void attach(event.target.files?.[0])}
          />
          <button
            type="button"
            disabled={!live || busy}
            onClick={() => fileInput.current?.click()}
            className="track-label flex-1 rounded-2xl border border-[var(--hairline)] py-5 text-[10px] font-bold disabled:opacity-40"
          >
            {busy ? "Compressing…" : photo ? "Replace photo" : "Add photo"}
          </button>
          <button
            type="button"
            disabled={!live || busy || (!text.trim() && !photo)}
            onClick={post}
            className="track-label flex-1 rounded-2xl bg-[var(--ink)] py-5 text-[10px] font-bold text-[#12102e] disabled:opacity-40"
          >
            Post
          </button>
        </div>

        <p className="track-label text-[9px] font-medium text-[var(--muted)]">
          {error ?? (live ? `${MAX_UPDATE_TEXT - text.length} left` : "Start broadcasting to post")}
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-right text-[var(--ink)]">{value}</dd>
    </>
  );
}

function Button({
  children,
  onClick,
  disabled,
  muted,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`track-label w-full rounded-2xl border py-7 text-[12px] font-bold transition-colors disabled:opacity-40 ${
        muted
          ? "border-[var(--hairline)] text-[var(--muted)]"
          : "border-transparent bg-[var(--ink)] text-[#12102e]"
      }`}
    >
      {children}
    </button>
  );
}

function Explanation({
  tracker,
  me,
  broadcasting,
  hasKey,
  pinned,
}: {
  tracker: ReturnType<typeof useTracker>;
  me: ReturnType<typeof useGeolocation>;
  broadcasting: boolean;
  hasKey: boolean;
  pinned: boolean;
}) {
  if (!hasKey) return <>Open this page with ?key=… to take the tracker.</>;
  if (tracker.denied === "auth") return <>That key was rejected.</>;
  if (tracker.denied === "locked") return <>Another device holds the tracker. Taking over will disconnect it.</>;
  if (tracker.denied === "superseded") return <>Another device took the tracker from this one.</>;
  if (!broadcasting) return <>Only one device can broadcast at a time.</>;
  if (tracker.status !== "open") return <>Connecting…</>;
  if (pinned) return <>Broadcasting the spot you pinned, not GPS.</>;
  if (me.error) return <>{me.error}</>;
  if (!me.coords) return <>Waiting for a location fix…</>;
  return <>Broadcasting your position.</>;
}
