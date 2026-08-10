// Encodes the raw recording from video.spec.ts into what the site serves:
// site/video/quaero-demo.webm (VP9) + .mp4 (H.264). The poster is written by the
// spec itself, at the moment the caption describes.
//
// Two formats because the <video> lists both sources: WebM/VP9 is smaller, MP4/H.264
// is what Safari plays. Encoded from the same input so they cannot drift.
//
// The knobs are chosen for a file that lives in the repo and autoplays on a landing
// page: 15 fps (a UI recording has no motion that needs more), and CRF high enough to
// keep it in the hundreds of KB. The floor on quality is text legibility — the point
// of the video is that you can read the SQL and the grid.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT = join(import.meta.dirname, "..", "..", "..", "site", "video");
const RAW = join(OUT, ".raw.webm");

if (!existsSync(RAW)) {
  console.error(`no recording at ${RAW}\nrun: pnpm video`);
  process.exit(1);
}

const run = (args, capture = false) => {
  const r = spawnSync("ffmpeg", args, {
    stdio: ["ignore", "ignore", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) {
    console.error("ffmpeg not found on PATH — install it to encode the demo video.");
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(r.stderr?.toString().split("\n").slice(-20).join("\n"));
    process.exit(r.status ?? 1);
  }
  return capture ? (r.stderr?.toString() ?? "") : "";
};

/** Blank lead-in is near-white; the app's dark UI sits far below this. */
const BLANK = 150;

/** Mean luma of the frame at `t` seconds, 0 (black) to 255 (white). */
function luma(t, file = RAW) {
  const out = run(["-hide_banner", "-ss", String(t), "-i", file, "-frames:v", "1",
                   "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
                   "-f", "null", "-"], true);
  const m = out.match(/YAVG=\s*([\d.]+)/);
  return m ? Number(m[1]) : Number.NaN;
}

/**
 * Finds where the app's first painted frame is.
 *
 * The recording starts when the browser context does, which is before the demo has
 * seeded its database and navigated, so the video opens on a blank white page. How
 * long that lasts depends on how fast the machine seeds — a fixed offset either cuts
 * into the demo or leaves a white flash at the top of a looping video. So the frame
 * is measured instead of assumed: blank is near-white (~250) and the app's dark UI is
 * far below that.
 */
function findStart() {
  const LIMIT = 40; // seconds; well past any plausible seed
  for (let t = 0; t < LIMIT; t += 0.25) {
    const y = luma(t);
    // Nudged past the boundary, never back from it: losing 30 ms of the app is
    // invisible, whereas one leftover white frame flashes on every loop.
    if (Number.isFinite(y) && y < BLANK) return t + 0.03;
  }
  console.error("could not find the app's first frame in the recording (all blank?)");
  process.exit(1);
}

const TRIM = String(findStart());
console.log(`  trimming ${TRIM}s of blank lead-in`);

const common = ["-y", "-ss", TRIM, "-i", RAW, "-an", "-r", "15", "-pix_fmt", "yuv420p"];

const webm = join(OUT, "quaero-demo.webm");
run([...common, "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-row-mt", "1", webm]);

const mp4 = join(OUT, "quaero-demo.mp4");
run([...common, "-c:v", "libx264", "-preset", "slow", "-crf", "27",
     "-movflags", "+faststart", mp4]);

// The trim is measured, so verify it landed: a single leftover white frame is
// invisible in a file listing and flashes on every loop of an autoplaying video.
for (const f of [webm, mp4]) {
  const y = luma(0, f);
  if (!(y < BLANK)) {
    console.error(`${f} still opens on a blank frame (YAVG=${y}) — trim was ${TRIM}s`);
    process.exit(1);
  }
}

rmSync(RAW, { force: true });

for (const f of [webm, mp4, join(OUT, "quaero-demo-poster.png")]) {
  const kb = existsSync(f) ? Math.round(statSync(f).size / 1024) : 0;
  console.log(`  ${f.slice(dirname(OUT).length + 1)}  ${kb} KB`);
}
