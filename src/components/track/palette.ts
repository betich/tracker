/**
 * Every colour in the UI traces back to `config.primaryColor` (see
 * tracker.config.ts): one hue and saturation held constant while lightness
 * sweeps from near-black up to the primary itself. `groundColor`/`glowColor`
 * take the 0–1 nearness that proximity.ts turns metres into; the rest are
 * fixed tints of the same hue for chrome outside the proximity screens.
 */
import { config } from "@config";
import { clamp01, hexToHsl, hsl, shade, tint } from "@/lib/color";

const primary = hexToHsl(config.primaryColor);

/** The ground colour at nearness `t` (0 = farthest/darkest, 1 = the primary itself). */
export function groundColor(t: number): string {
  return hsl(shade(primary, t));
}

/** Halo behind the dial — a light tint of the primary, brightening with `t`. */
export function glowColor(t: number): string {
  return hsl(tint(primary, 0.25), 0.06 + clamp01(t) * 0.34);
}

/** Page background outside the proximity screens — the ramp's darkest stop. */
export const GROUND_DARK = groundColor(0);

/** The halo colour at rest, for chrome that isn't wired to live proximity. */
export const GLOW_DARK = glowColor(0);

/** Near-white foreground text, tinted with the primary hue. */
export const INK = hsl({ h: primary.h, s: primary.s, l: 97.5 });

/** Dark text for buttons and pills that sit on top of `INK`. */
export const INK_CONTRAST = hsl({ h: primary.h, s: primary.s * 0.5, l: 12 });
