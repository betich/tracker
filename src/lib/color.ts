/**
 * Small HSL mixing helpers. Kept free of any tracker-specific knowledge so
 * palette.ts can turn a single configured colour into every shade the UI
 * needs from it.
 */

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function hexToHsl(hex: string): Hsl {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const int = parseInt(full, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const delta = max - min;
  const s = delta / (1 - Math.abs(2 * l - 1));
  const h =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;

  return { h: ((h * 60) + 360) % 360, s: s * 100, l: l * 100 };
}

/** A CSS `hsl()` string, with an optional alpha. */
export function hsl({ h, s, l }: Hsl, alpha = 1): string {
  const a = alpha === 1 ? "" : ` / ${alpha.toFixed(3)}`;
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%${a})`;
}

/**
 * `base` eased from near-black up to itself as `t` goes 0 → 1. Saturation
 * ramps up alongside lightness so the dark end reads as ink, not grey.
 */
export function shade(base: Hsl, t: number): Hsl {
  const eased = clamp01(t);
  return {
    h: base.h,
    s: lerp(base.s * 0.6, base.s, eased),
    l: lerp(base.l * 0.09, base.l, eased),
  };
}

/** `base` lightened toward white by `amount` (0–1), hue and saturation held. */
export function tint(base: Hsl, amount: number): Hsl {
  return { h: base.h, s: base.s, l: lerp(base.l, 100, amount) };
}
