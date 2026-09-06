import { useCallback, useState } from "react";
import { FaHeart, FaRegHeart } from "react-icons/fa";
import type { Update } from "@tracker/protocol";
import type { ClientMessage } from "@tracker/protocol";
import { photoUrl } from "./endpoint";
import { formatAge } from "./geo";
import { readLiked, viewerId, writeLiked } from "./viewer";

interface TimelineProps {
  updates: Update[];
  /** Ticking clock from the parent, so every card ages on the same beat. */
  now: number;
  send: (message: ClientMessage) => void;
}

/**
 * Status updates as a horizontal reel of full-bleed cards. One card fills the
 * screen and snaps, so reading is a swipe rather than a scroll through a feed —
 * and the text stays at the same absurd size as the distance readout.
 */
export default function Timeline({ updates, now, send }: TimelineProps) {
  // Seeded once from storage; the server owns the counts, this owns "did I".
  const [liked, setLiked] = useState<Set<string>>(() => readLiked());

  const toggleLike = useCallback(
    (id: string) => {
      setLiked((current) => {
        const next = new Set(current);
        const on = !next.has(id);
        on ? next.add(id) : next.delete(id);
        writeLiked(next);
        send({ t: "like", id, viewer: viewerId(), on });
        return next;
      });
    },
    [send],
  );

  if (updates.length === 0) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <p className="track-label text-[11px] font-bold text-[var(--muted)]">No updates yet</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-hidden px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Status updates"
    >
      {updates.map((update, index) => {
        const mine = liked.has(update.id);
        return (
          <article
            key={update.id}
            className="flex h-full w-[86vw] max-w-xl shrink-0 snap-center flex-col overflow-hidden rounded-3xl border border-[var(--hairline)] bg-white/[0.07]"
          >
            {update.hasPhoto && (
              <img
                src={photoUrl(update.id)}
                alt=""
                loading={index < 2 ? "eager" : "lazy"}
                decoding="async"
                className="min-h-0 w-full flex-1 object-cover"
              />
            )}

            <div
              className={`flex shrink-0 flex-col gap-3 px-6 py-6 ${update.hasPhoto ? "" : "min-h-0 flex-1 justify-center"}`}
            >
              {update.text && (
                <p
                  className="font-bold leading-[0.95]"
                  style={{
                    // A photoless card gives the words the whole surface.
                    fontSize: update.hasPhoto ? "clamp(1.4rem, 6vw, 2.25rem)" : "clamp(2rem, 10vw, 4rem)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {update.text}
                </p>
              )}

              <div className="flex items-center justify-between gap-4">
                <p className="track-label text-[10px] font-bold text-[var(--muted)]">
                  {formatAge(now - update.ts)}
                  {updates.length > 1 && (
                    <span className="opacity-60">
                      {" "}
                      · {index + 1}/{updates.length}
                    </span>
                  )}
                </p>

                <button
                  type="button"
                  onClick={() => toggleLike(update.id)}
                  aria-pressed={mine}
                  aria-label={mine ? "Remove your like" : "Like this update"}
                  className="track-label flex items-center gap-2 rounded-full border px-4 py-2.5 text-[11px] font-bold transition-colors active:scale-95"
                  style={{
                    borderColor: mine ? "var(--beacon)" : "var(--hairline)",
                    color: mine ? "var(--beacon)" : "var(--ink)",
                  }}
                >
                  {mine ? <FaHeart className="h-3.5 w-3.5" /> : <FaRegHeart className="h-3.5 w-3.5" />}
                  {update.likes}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
