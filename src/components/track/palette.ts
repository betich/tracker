/**
 * Every colour in the UI traces back to one primary: one hue and saturation
 * held constant while lightness sweeps from near-black up to the primary
 * itself. `groundColor`/`glowColor` take the 0–1 nearness that proximity.ts
 * turns metres into; the rest are fixed tints of the same hue for chrome
 * outside the proximity screens.
 *
 * The deployment's own primary comes from tracker.config.ts at build time. A
 * hosted tracker may carry its own instead — chosen on /new, resolved with the
 * tenant — so everything here takes an optional primary and falls back.
 */
import { config } from "@config";
import { clamp01, hexToHsl, hsl, shade, tint, type Hsl } from "@/lib/color";
import { normalizeColor } from "@tracker/protocol";

const own = hexToHsl(config.primaryColor);

/** A validated hex as HSL, or the deployment's own primary for anything else. */
function primaryOf(color?: string | null): Hsl {
  const valid = normalizeColor(color);
  return valid ? hexToHsl(valid) : own;
}

/** The ground colour at nearness `t` (0 = farthest/darkest, 1 = the primary itself). */
export function groundColor(t: number, color?: string | null): string {
  return hsl(shade(primaryOf(color), t));
}

/** Halo behind the dial — a light tint of the primary, brightening with `t`. */
export function glowColor(t: number, color?: string | null): string {
  return hsl(tint(primaryOf(color), 0.25), 0.06 + clamp01(t) * 0.34);
}

/** Near-white foreground text, tinted with the primary hue. */
export function inkColor(color?: string | null): string {
  const primary = primaryOf(color);
  return hsl({ h: primary.h, s: primary.s, l: 97.5 });
}

/** Dark text for buttons and pills that sit on top of the ink. */
export function inkContrastColor(color?: string | null): string {
  const primary = primaryOf(color);
  return hsl({ h: primary.h, s: primary.s * 0.5, l: 12 });
}

/**
 * The custom properties a surface sets to wear `color` instead of the
 * deployment's own. `--ground` and `--glow` follow live proximity, so they are
 * passed the nearness; the ink pair is fixed per tracker.
 */
export function paletteVars(t: number, color?: string | null): Record<string, string> {
  return {
    "--ground": groundColor(t, color),
    "--glow": glowColor(t, color),
    "--ink": inkColor(color),
    "--ink-contrast": inkContrastColor(color),
  };
}

/** Page background outside the proximity screens — the ramp's darkest stop. */
export const GROUND_DARK = groundColor(0);

/** The halo colour at rest, for chrome that isn't wired to live proximity. */
export const GLOW_DARK = glowColor(0);

/** Near-white foreground text, tinted with the primary hue. */
export const INK = inkColor();

/** Dark text for buttons and pills that sit on top of `INK`. */
export const INK_CONTRAST = inkContrastColor();
