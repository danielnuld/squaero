// Web copies of the screenshots (issue #753): every assets/media/screenshot-*.png
// becomes site/img/<name>.avif, .webp and .png (the fallback), same pixel size.
//
//   node scripts/site-images.mjs      (`pnpm media` in frontend/ runs it last)
//
// Encoded with ffmpeg (libaom-av1 and libwebp), which has to be on PATH; no npm
// image package is added for a release chore. It fails rather than leaving an
// .avif from the previous set next to a new .webp.

import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "assets", "media");
const OUT = join(ROOT, "site", "img");

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
try {
  ff(["-version"]);
} catch {
  console.error("ffmpeg not found on PATH: it encodes the AVIF and WebP copies.");
  process.exit(1);
}

// The previous set goes first, so a screen that is no longer shot leaves no orphan.
for (const f of readdirSync(OUT)) {
  if (/^screenshot-.*\.(png|webp|avif)$/.test(f)) unlinkSync(join(OUT, f));
}

for (const f of readdirSync(SRC).filter((f) => /^screenshot-.*\.png$/.test(f)).sort()) {
  const src = join(SRC, f);
  const base = join(OUT, f.replace(/\.png$/, ""));
  copyFileSync(src, `${base}.png`);
  ff(["-i", src, "-c:v", "libwebp", "-quality", "88", "-compression_level", "6", `${base}.webp`]);
  // 4:4:4 keeps coloured text crisp; 4:2:0 smears it on a screenshot.
  ff(["-i", src, "-c:v", "libaom-av1", "-still-picture", "1", "-crf", "28", "-cpu-used", "4", "-pix_fmt", "yuv444p", `${base}.avif`]);
  console.log(`  site/img/${f.replace(/\.png$/, "")}.{avif,webp,png}`);
}
