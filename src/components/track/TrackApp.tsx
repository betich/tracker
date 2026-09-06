import { useEffect, useRef, useState } from "react";
import Compass, { COMPASS_CENTER } from "./Compass";
import TrackMap from "./TrackMap";
import Timeline from "./Timeline";
import SpinnyMark from "./SpinnyMark";
import ContactButtons from "./ContactButtons";
import { useTracker } from "./useTracker";
import { useAngleDriver, useDeviceHeading, useGeolocation } from "./sensors";
import {
  bearing,
  compassPoint,
  distance,
  formatAge,
  formatDistance,
  hasArrived,
  normalize,
  shortestTurn,
  steer,
} from "./geo";
import { glowColor, groundColor, proximity } from "./proximity";
import { useTenant } from "./tenant";
import "./track.css";

/** A fix older than this is shown as stale rather than live. */
const STALE_AFTER_MS = 20_000;

type Tab = "compass" | "map" | "updates";

export default function TrackApp() {
  const { slug, subject, portrait } = useTenant();
  // A hosted page names its tracker; the deployment's own uses the server default.
  const tracker = useTracker(slug ? { role: "viewer", tracker: slug } : { role: "viewer" });
  const me = useGeolocation();
  const heading = useDeviceHeading();

  const [tab, setTab] = useState<Tab>("compass");
  const [fitKey, setFitKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const ringRef = useRef<SVGGElement>(null);
  const needleRef = useRef<SVGGElement>(null);

  // Drives the "3s ago" readout and the live/stale badge.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const bundit = tracker.fix ? { lat: tracker.fix.lat, lon: tracker.fix.lon } : null;
  const metres = me.coords && bundit ? distance(me.coords, bundit) : null;
  const course = me.coords && bundit ? bearing(me.coords, bundit) : null;

  // Fall back to course over ground where there's no magnetometer — on a laptop,
  // or with motion access denied, a moving device can still orient itself.
  const facing = heading.degrees ?? me.heading;

  // The dial reads the live ref rather than `facing`, so it turns at sensor rate
  // while the wording below only re-renders a few times a second.
  useAngleDriver(() => {
    const live = heading.live.current ?? me.heading ?? 0;
    return [
      { element: ringRef.current, degrees: -live, origin: COMPASS_CENTER },
      {
        element: needleRef.current,
        degrees: course === null ? null : normalize(course - live),
        origin: COMPASS_CENTER,
      },
    ];
  });

  // Two consumer GPS fixes disagree by metres even when the devices touch, so
  // past a point the number is noise. Say so rather than quoting it.
  const uncertainty = (me.accuracy ?? 0) + (tracker.fix?.acc ?? 0);
  const arrived = hasArrived(metres, uncertainty);

  // Signed degrees from straight-ahead to the bundit; drives both the wording
  // and the beacon's locked state. Meaningless once you've arrived, because the
  // bearing between two overlapping fixes is whatever the noise says.
  const offset =
    arrived || course === null || facing === null ? null : shortestTurn(0, normalize(course - facing));
  const heads = steer(offset);

  const nearness = arrived ? 1 : proximity(metres);
  const age = tracker.fix ? now + tracker.clockSkew - tracker.fix.ts : null;
  const stale = age !== null && age > STALE_AFTER_MS;

  const readout = metres === null ? null : formatDistance(metres);

  const show = (next: Tab) => {
    setTab(next);
    if (next === "map") setFitKey((key) => key + 1);
  };

  return (
    <div
      className="track flex flex-col font-mono"
      style={{ "--ground": groundColor(nearness), "--glow": glowColor(nearness) } as React.CSSProperties}
    >
      <header className="flex shrink-0 items-center justify-between px-5 pb-1 pt-[max(0.85rem,env(safe-area-inset-top))]">
        <span className="track-label text-[11px] font-bold">{subject}</span>
        <Status tracker={tracker} stale={stale} />
      </header>

      {tab === "compass" ? (
        <>
          <div className="relative grid min-h-0 flex-1 place-items-center px-4">
            <div className="track-glow pointer-events-none absolute inset-0" />
            {/*
              Absolute with BOTH vertical insets, which is what makes this box's
              height definite. Percentage heights do not resolve against a grid
              area — the browser falls back to content height, so the dial sized
              itself square from its width and spilled over the readout on any
              short screen. The SVG letterboxes itself, so the face stays round.
            */}
            <div className="absolute inset-y-2 left-1/2 w-full max-w-[28rem] -translate-x-1/2 px-4">
              <Compass
                ringRef={ringRef}
                needleRef={needleRef}
                hasTarget={course !== null && !arrived}
                locked={heads?.locked ?? false}
              />
            </div>
          </div>

          <div className="shrink-0 px-5 pb-3 text-center">
            {/*
              One line that always says the most useful thing it can: how to
              turn, or why it can't say yet.
            */}
            {/*
              Positioned, so it paints above the readout below it. The figure
              sets line-height 0.78, which leaves its glyphs overflowing tens of
              pixels above their own box — and that overflow is hit-tested, so
              in normal flow the number silently ate taps on this button.
            */}
            <div className="relative z-10 mb-1 flex min-h-[3rem] items-center justify-center">
              {arrived ? (
                <p className="track-label text-[13px] font-bold" style={{ color: "var(--beacon-locked)" }}>
                  you're on top of it
                </p>
              ) : heading.permission === "prompt" ? (
                <button
                  type="button"
                  onClick={() => void heading.request()}
                  className="track-label grid min-h-[44px] place-items-center rounded-full border border-[var(--hairline)] bg-white/[0.06] px-6 text-[10px] font-bold"
                >
                  Tap to enable compass
                </button>
              ) : heads ? (
                <p
                  className="track-label text-[13px] font-bold transition-colors"
                  style={{ color: heads.locked ? "var(--beacon-locked)" : "var(--beacon)" }}
                >
                  {heads.label}
                </p>
              ) : (
                <p className="track-label text-[10px] font-bold text-[var(--muted)]">
                  {course === null ? "" : "north-up · no compass"}
                </p>
              )}
            </div>

            <div className="track-figure font-bold">
              {arrived ? "HERE" : (readout?.value ?? <span className="opacity-25">···</span>)}
            </div>
            <div className="track-unit track-label mt-3 font-bold text-[var(--muted)]">
              {arrived ? "look around" : readout ? `${readout.unit} away` : ""}
            </div>
            <p className="track-label mt-4 min-h-[1rem] text-[10px] font-medium text-[var(--muted)]">
              {readout ? <Detail course={course} fix={tracker.fix} age={age} metres={arrived ? metres : null} /> : <Reason tracker={tracker} me={me} age={age} />}
            </p>
          </div>
        </>
      ) : tab === "map" ? (
        <div className="relative min-h-0 flex-1">
          <TrackMap me={me.coords} bundit={bundit} fitKey={fitKey} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 pb-3">
          <Timeline updates={tracker.updates} now={now} send={tracker.send} />
        </div>
      )}

      <ContactButtons />

      {portrait && <SpinnyMark headingRef={heading.live} reserveRight />}

      <nav className="grid shrink-0 grid-cols-3 border-t border-[var(--hairline)] pb-[env(safe-area-inset-bottom)]">
        {(["compass", "map", "updates"] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => show(name)}
            aria-current={tab === name}
            className={`track-label relative py-6 text-[11px] font-bold transition-colors ${
              tab === name ? "bg-white/10 text-[var(--ink)]" : "text-[var(--muted)]"
            }`}
          >
            {name}
            {name === "updates" && tracker.updates.length > 0 && tab !== "updates" && (
              <span className="absolute right-[22%] top-[34%] h-1.5 w-1.5 rounded-full bg-[var(--ink)]" />
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** The live badge: colour and wording both come from the freshest thing we know. */
function Status({ tracker, stale }: { tracker: ReturnType<typeof useTracker>; stale: boolean }) {
  const [label, tone] =
    tracker.status === "connecting"
        ? ["connecting", "var(--stale)"]
        : tracker.status === "offline"
          ? ["reconnecting", "var(--dead)"]
          : !tracker.tracking
            ? ["not tracking", "var(--dead)"]
            : stale
              ? ["stale", "var(--stale)"]
              : ["live", "var(--live)"];

  return (
    <span className="track-label flex items-center gap-2 text-[10px] font-bold text-[var(--muted)]">
      <span className="relative flex h-2 w-2">
        {tone === "var(--live)" && <span className="track-pulse absolute inset-0 rounded-full bg-[var(--live)]" />}
        <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
      </span>
      {label}
      {tracker.viewers > 1 && <span className="opacity-60">· {tracker.viewers} watching</span>}
    </span>
  );
}

/** Supporting numbers, shown only once there is a distance to support. */
function Detail({
  course,
  fix,
  age,
  metres,
}: {
  course: number | null;
  fix: ReturnType<typeof useTracker>["fix"];
  age: number | null;
  /** The raw reading, shown only once the headline has stopped quoting it. */
  metres: number | null;
}) {
  const parts = [
    // Bearing is noise at arm's length; the raw gap is the honest thing to show.
    metres !== null ? `reads ${Math.round(metres)} m` : course !== null ? `${compassPoint(course)} ${Math.round(course)}°` : null,
    // A null accuracy means the spot was pinned by hand, not read off GPS.
    fix?.acc ? `±${Math.round(fix.acc)}m` : "pinned",
    age !== null ? formatAge(age) : null,
  ].filter(Boolean);

  return <>{parts.join("  ·  ")}</>;
}

/** Why there is no distance to show. */
function Reason({
  tracker,
  me,
  age,
}: {
  tracker: ReturnType<typeof useTracker>;
  me: ReturnType<typeof useGeolocation>;
  age: number | null;
}) {
  if (me.error) return <>{me.error}</>;
  if (!me.coords) return <>Waiting for your location</>;
  if (!tracker.fix) return <>No signal from bundit yet</>;
  return <>Last seen {age !== null ? formatAge(age) : "a while ago"}</>;
}
