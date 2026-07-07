// WCAG 2.1 contrast math (issue #220). Pure, dependency-free helpers used to
// assert that accent text meets AA against the surfaces it is painted on. Kept
// as a real module (not test-only) so any future palette work can reuse it.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse a `#rgb` or `#rrggbb` hex string into 0–255 channels. Throws on a
 *  malformed value so a bad palette token fails loudly rather than silently. */
export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Relative luminance per WCAG 2.1 (sRGB, D65). Input channels are 0–255. */
export function relativeLuminance(c: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio (≥1) between two colors given as hex strings. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA threshold for normal-size text. */
export const AA_NORMAL = 4.5;
