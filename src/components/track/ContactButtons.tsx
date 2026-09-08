import { useEffect, useRef, useState } from "react";
import { FaLine, FaPhone } from "react-icons/fa";

import { useTenant } from "./tenant";

const COPIED_MS = 1800;

/**
 * Best-effort copy. The async Clipboard API needs a secure context, so fall
 * back to a throwaway textarea for anything that refuses it.
 */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.setAttribute("readonly", "");
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      const copied = document.execCommand("copy");
      scratch.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

type Copied = "phone" | "line" | null;

/**
 * Fixed to the bottom right on every tracker tab: call, or take the LINE ID.
 *
 * It rides in the band between the tab bar and the content, which is why the
 * portrait beside it is left-aligned — stacked or any higher and it covered the
 * distance readout. Both actions copy their number; the LINE one because
 * pasting into "add by phone number" is the only way to act on an ID.
 */
export default function ContactButtons() {
  const { contacts } = useTenant();
  const { phone: PHONE, lineId: LINE_ID } = contacts;
  const [copied, setCopied] = useState<Copied>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const flash = (which: Exclude<Copied, null>) => {
    setCopied(which);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };

  // Nothing configured, nothing to show.
  if (!PHONE && !LINE_ID) return null;

  return (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] right-4 z-[2000] flex items-center gap-2.5">
      {LINE_ID && (
      <button
        type="button"
        onClick={() => void copy(LINE_ID).then((ok) => ok && flash("line"))}
        aria-label={`Copy LINE ID ${LINE_ID}`}
        className="track-label flex h-12 items-center gap-2.5 rounded-full bg-[#06c755] px-4 text-[11px] font-bold text-white shadow-lg shadow-black/30 transition-transform active:scale-95"
      >
        <FaLine className="h-4 w-4 shrink-0" aria-hidden="true" />
        {copied === "line" ? "copied · add by phone" : LINE_ID}
      </button>
      )}

      {PHONE && (
      <a
        href={`tel:${PHONE}`}
        onClick={() => void copy(PHONE).then((ok) => ok && flash("phone"))}
        aria-label={`Call ${PHONE}`}
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--ink)] text-[var(--ink-contrast)] shadow-lg shadow-black/30 transition-transform active:scale-95"
      >
        {copied === "phone" ? (
          <span className="track-label text-[9px] font-bold">copied</span>
        ) : (
          <FaPhone className="h-5 w-5" aria-hidden="true" />
        )}
      </a>
      )}

      <span className="sr-only" aria-live="polite">
        {copied === "line" ? "LINE ID copied" : copied === "phone" ? "Phone number copied" : ""}
      </span>
    </div>
  );
}
