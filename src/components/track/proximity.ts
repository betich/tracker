/**
 * Distance in, a 0–1 nearness out — what palette.ts turns into the ground
 * colour and halo. Mapped logarithmically, because the felt difference
 * between 10m and 20m is the same as between 100m and 200m.
 */

/** At or under this many metres, nearness is at its maximum. */
const NEAR_M = 4;
/** At or beyond this many metres, nearness is at its minimum. */
const FAR_M = 3_000;

/** 0 when far away or unknown, 1 when right on top of it. */
export function proximity(metres: number | null): number {
  if (metres === null || !Number.isFinite(metres)) return 0;
  const span = Math.log(FAR_M / NEAR_M);
  return Math.min(1, Math.max(0, 1 - Math.log(Math.max(metres, NEAR_M) / NEAR_M) / span));
}
