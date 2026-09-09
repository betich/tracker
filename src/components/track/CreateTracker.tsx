import { useState } from "react";
import { TRACKER_URL } from "./endpoint";
import { paletteVars } from "./palette";
import { config } from "@config";
import "./track.css";

interface Made {
  slug: string;
  adminKey: string;
}

/**
 * There is no proximity to express here, so the screen sits at a fixed point on
 * the ramp: far enough up to read as the primary colour rather than as black,
 * and no further — this page is small type, and the muted labels stay above
 * 4.5:1 against the ground here.
 */
const GROUND = 0.3;

/**
 * Offered as swatches so the common case is one tap. The native picker sits
 * beside them for anything else, and whatever is chosen is what the whole page
 * immediately turns — the form doubles as the preview.
 */
const PRESETS = [
  config.primaryColor,
  "#ff6b35",
  "#f4436c",
  "#22c55e",
  "#0ea5e9",
  "#eab308",
] as const;

/**
 * Mints a tracker on a shared deployment. The admin key comes back exactly once
 * — the server keeps only its hash — so the result screen is the only chance to
 * save it, and says so.
 */
export default function CreateTracker() {
  const [subject, setSubject] = useState("");
  const [phone, setPhone] = useState("");
  const [lineId, setLineId] = useState("");
  const [color, setColor] = useState<string>(config.primaryColor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!subject.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${TRACKER_URL}/api/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          phone: phone.trim() || null,
          lineId: lineId.trim() || null,
          color,
        }),
      });
      const body = (await response.json()) as Made | { error: string };
      if ("error" in body) setError(body.error);
      else setMade(body);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (made) return <Result made={made} color={color} />;

  return (
    <div
      className="track relative flex min-h-[var(--app-h,100dvh)] flex-col justify-center font-mono"
      style={paletteVars(GROUND, color) as React.CSSProperties}
    >
      <div className="track-glow pointer-events-none absolute inset-0" />
      <form onSubmit={submit} className="relative mx-auto w-full max-w-md space-y-6 px-6 py-10">
        <div>
          <h1 className="text-[clamp(2rem,9vw,3rem)] font-bold leading-[0.95] tracking-tight">
            New tracker
          </h1>
          <p className="track-label mt-3 text-[10px] font-medium leading-relaxed text-[var(--muted)]">
            One link for the person walking, one for everyone waiting.
          </p>
        </div>

        <Field label="Who or what is being tracked" hint="Shown in the header and on the map.">
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value.slice(0, 40))}
            placeholder="bundit"
            autoFocus
            className="w-full bg-transparent text-[clamp(1.5rem,7vw,2.25rem)] font-bold tracking-tight placeholder:text-[var(--muted)] focus:outline-none"
          />
        </Field>

        <Field label="Phone" hint="Optional. Adds a call button.">
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value.slice(0, 24))}
            placeholder="+66…"
            inputMode="tel"
            className="w-full bg-transparent text-lg font-bold placeholder:text-[var(--muted)] focus:outline-none"
          />
        </Field>

        <Field label="LINE ID" hint="Optional. Shown for add-by-phone-number.">
          <input
            value={lineId}
            onChange={(event) => setLineId(event.target.value.slice(0, 24))}
            placeholder="08…"
            className="w-full bg-transparent text-lg font-bold placeholder:text-[var(--muted)] focus:outline-none"
          />
        </Field>

        <Field label="Colour" hint="The whole tracker is built from it.">
          <div className="flex items-center gap-2.5 pt-1">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                aria-label={`Use ${preset}`}
                aria-pressed={color === preset}
                className="h-9 w-9 shrink-0 rounded-full border-2 transition-transform active:scale-90"
                style={{
                  background: preset,
                  borderColor: color === preset ? "var(--ink)" : "transparent",
                }}
              />
            ))}
            {/*
              The escape hatch for anything not offered. Deliberately a spectrum
              rather than the current colour: painting it with `color` would make
              it a second copy of whichever preset is selected.
            */}
            <label
              className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full border-2 transition-transform active:scale-90"
              style={{
                background:
                  "conic-gradient(#ff4d4d,#ffd166,#7ff0a8,#38bdf8,#a78bfa,#f472b6,#ff4d4d)",
                borderColor: PRESETS.includes(color as (typeof PRESETS)[number])
                  ? "transparent"
                  : "var(--ink)",
              }}
            >
              <span className="sr-only">Pick any colour</span>
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="absolute -left-2 -top-2 h-16 w-16 cursor-pointer border-0 bg-transparent p-0 opacity-0"
              />
            </label>
          </div>
        </Field>

        <button
          type="submit"
          disabled={!subject.trim() || busy}
          className="track-label w-full rounded-2xl bg-[var(--ink)] py-6 text-[11px] font-bold text-[var(--ink-contrast)] disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create tracker"}
        </button>

        <p className="track-label min-h-[1rem] text-[9px] font-medium leading-relaxed text-[var(--muted)]">
          {error ?? "Trackers are dropped a week after they were last opened."}
        </p>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2 rounded-2xl border border-[var(--hairline)] bg-white/[0.06] px-5 py-4">
      <span className="track-label block text-[9px] font-bold text-[var(--muted)]">{label}</span>
      {children}
      <span className="track-label block text-[9px] font-medium text-[var(--muted)]">{hint}</span>
    </label>
  );
}

function Result({ made, color }: { made: Made; color: string }) {
  const origin = typeof location === "undefined" ? "" : location.origin;
  const share = `${origin}/t/${made.slug}`;
  const admin = `${share}/admin?key=${made.adminKey}`;

  return (
    <div
      className="track relative flex min-h-[var(--app-h,100dvh)] flex-col justify-center font-mono"
      style={paletteVars(GROUND, color) as React.CSSProperties}
    >
      <div className="track-glow pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-md space-y-6 px-6 py-10">
        <h1 className="text-[clamp(2rem,9vw,3rem)] font-bold leading-[0.95] tracking-tight">
          Ready
        </h1>

        <Copyable label="Share this" value={share} note="Anyone with this link can watch." />
        <Copyable
          label="Your admin link"
          value={admin}
          note="Open it on the phone doing the walking."
          warn
        />

        <p className="track-label text-[9px] font-medium leading-relaxed text-[var(--muted)]">
          The admin link is shown only now — it is not stored anywhere you can read it back. Save it
          before you close this page.
        </p>

        <a
          href={share}
          className="track-label block w-full rounded-2xl bg-[var(--ink)] py-6 text-center text-[11px] font-bold text-[var(--ink-contrast)]"
        >
          Open the tracker
        </a>
      </div>
    </div>
  );
}

function Copyable({
  label,
  value,
  note,
  warn,
}: {
  label: string;
  value: string;
  note: string;
  warn?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="space-y-3 rounded-2xl border bg-white/[0.06] px-5 py-4"
      style={{ borderColor: warn ? "var(--beacon)" : "var(--hairline)" }}
    >
      <span
        className="track-label block text-[9px] font-bold"
        style={{ color: warn ? "var(--beacon)" : "var(--muted)" }}
      >
        {label}
      </span>
      <p className="break-all text-[13px] font-bold leading-relaxed">{value}</p>
      <div className="flex items-center justify-between gap-4">
        <span className="track-label text-[9px] font-medium text-[var(--muted)]">{note}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="track-label shrink-0 rounded-full border border-[var(--hairline)] px-4 py-2.5 text-[9px] font-bold"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
  );
}
