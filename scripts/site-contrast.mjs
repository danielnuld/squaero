// WCAG 2.2 AA contrast of the site's four styles, read from site/site.css.
//   node scripts/site-contrast.mjs        (exit code 1 if any pair fails)
// Worst case: text straight on the page and on glass, over the plain background,
// under either glow and under both at their peak alpha. Text needs 4.5:1;
// control edges, the accent button fill and the error underline need 3:1.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../site/site.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const block = (selector) => {
  const at = css.indexOf(selector + " {");
  if (at < 0) throw new Error(`site.css: no block for ${selector}`);
  const body = css.slice(at, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const light = block(':root[data-style="b"]');
const dark = block(':root[data-style="a"],\n:root[data-style="c"]'); // the shared dark set
const styles = {
  b: light,
  a: { ...light, ...block(':root[data-style="a"]'), ...dark },
  c: { ...light, ...block(':root[data-style="c"]'), ...dark },
  rosa: { ...light, ...block(':root[data-style="rosa"]') },
};

const rgb = (v) => (v.startsWith("#") ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) : v.split(/\s+/).map(Number));
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const lum = (c) => {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

let failures = 0;
// The automatic dark page (no data-style, system dark) must be exactly A.
for (const [k, v] of Object.entries(block(":root:not([data-style])"))) {
  if (styles.a[k] !== v) { failures++; console.log(`FAIL automatic dark differs from A in --${k}: ${v} vs ${styles.a[k]}`); }
}
for (const [id, t] of Object.entries(styles)) {
  const n = (k) => Number(t[k]);
  const bg = rgb(t.bg), surface = rgb(t["surface-rgb"]), accent = rgb(t["accent-rgb"]);
  const g1 = over(accent, n("a-glow1"), bg);
  const page = [bg, g1, over(rgb(t["glow2-rgb"]), n("a-glow2"), bg), over(rgb(t["glow2-rgb"]), n("a-glow2"), g1)];
  const glass = page.map((p) => over(surface, n("a-glass"), p));
  const strong = page.map((p) => over(surface, n("a-strong"), p));
  const wash = glass.map((p) => over(accent, n("a-wash"), p));
  const detected = glass.map((p) => over(accent, n("a-detected"), p));
  const solid = (k) => [rgb(t[k])];
  const checks = [
    ["ink / page", "ink", page, 4.5], ["dim / page", "dim", page, 4.5], ["accent-text / page", "accent-text", page, 4.5],
    ["ink / glass", "ink", glass, 4.5], ["dim / glass", "dim", glass, 4.5], ["accent-text / glass", "accent-text", glass, 4.5],
    ["ink / strong glass", "ink", strong, 4.5], ["dim / strong glass", "dim", strong, 4.5],
    ["ink / accent wash", "ink", wash, 4.5], ["dim / detected card", "dim", detected, 4.5],
    ["dim / surface", "dim", solid("surface"), 4.5], ["dim / soft", "dim", solid("soft"), 4.5], ["ink / soft", "ink", solid("soft"), 4.5],
    ["kw / surface", "kw", solid("surface"), 4.5], ["accent-fg / accent", "accent-fg", solid("accent"), 4.5],
    ["control edge / page", "ctl-edge", page, 3], ["control edge / glass", "ctl-edge", glass, 3],
    ["accent fill / page", "accent", page, 3], ["danger / surface", "danger", solid("surface"), 3],
  ];
  console.log(`\n${id}`);
  for (const [name, fg, bgs, min] of checks) {
    const r = Math.min(...bgs.map((b) => ratio(rgb(t[fg]), b)));
    if (r < min) failures++;
    console.log(`  ${r >= min ? "ok  " : "FAIL"} ${name.padEnd(22)} ${r.toFixed(2)} (min ${min})`);
  }
}
console.log(failures ? `\n${failures} pair(s) below AA` : "\nAll pairs meet WCAG 2.2 AA.");
process.exitCode = failures ? 1 : 0;
