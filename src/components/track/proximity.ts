/**
 * The whole screen is the readout: the closer the bundit gets, the brighter the
 * indigo ground burns. Distance is mapped logarithmically, because the felt
 * difference between 10m and 20m is the same as between 100m and 200m.
 */

/** At or under this many metres the screen is at full brightness. */
const NEAR_M = 4;
/** At or beyond this many metres it is at its darkest. */
const FAR_M = 3_000;

/** Ramp stops, darkest to brightest. Every stop keeps white type at 3:1 or better. */
const STOPS: Array<{ at: number; rgb: [number, number, number] }> = [
  { at: 0, rgb: [8, 7, 28] },
  { at: 0.3, rgb: [30, 27, 122] },
  { at: 0.6, rgb: [61, 58, 201] },
  { at: 0.85, rgb: [91, 88, 240] },
  { at: 1, rgb: [127, 124, 255] },
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 0 when far away or unknown, 1 when right on top of it. */
export function proximity(metres: number | null): number {
  if (metres === null || !Number.isFinite(metres)) return 0;
  const span = Math.log(FAR_M / NEAR_M);
  return clamp01(1 - Math.log(Math.max(metres, NEAR_M) / NEAR_M) / span);
}

/** The ground colour for a given proximity, as an `rgb()` string. */
export function groundColor(t: number): string {
  const eased = clamp01(t);
  let lower = STOPS[0];
  let upper = STOPS[STOPS.length - 1];

  for (let i = 0; i < STOPS.length - 1; i++) {
    if (eased >= STOPS[i].at && eased <= STOPS[i + 1].at) {
      lower = STOPS[i];
      upper = STOPS[i + 1];
      break;
    }
  }

  const span = upper.at - lower.at;
  const local = span === 0 ? 0 : (eased - lower.at) / span;
  const channel = (index: number) => Math.round(lower.rgb[index] + (upper.rgb[index] - lower.rgb[index]) * local);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

/** Halo behind the dial, so proximity reads even before you find the number. */
export function glowColor(t: number): string {
  return `rgb(160 158 255 / ${(0.06 + clamp01(t) * 0.34).toFixed(3)})`;
}
