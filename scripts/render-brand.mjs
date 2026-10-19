// Rasterizes the brand SVGs (issue #679) with the Chromium Playwright already
// uses, so no image tool is needed:
//   node scripts/render-brand.mjs      (run from the repo root, after
//                                       `pnpm install` in frontend/)
// - assets/brand/png/: the mark at 16–512 (solid tile at ≤32, stroke mark
//   above) and both wordmarks at 2× (Geist from frontend/src/assets/fonts).
// - assets/icons/: quaero.ico, quaero.icns and hicolor/, packed by
//   assets/icons/pack-icons.mjs from quaero-mark-solid.svg (≤32) and
//   assets/icons/quaero-app-icon.svg (≥48).
// The outputs are checked in; run this again only when a source SVG changes.
// The iPhone icon has its own script: scripts/ios/render-icon.mjs.

import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const svg = (p) => readFileSync(p, "utf8");
const geist = readFileSync("frontend/src/assets/fonts/Geist-Latin-Variable.woff2").toString("base64");
const fontFace = `@font-face{font-family:"Geist";font-weight:100 900;src:url(data:font/woff2;base64,${geist}) format("woff2")}`;

// CHROMIUM_PATH: a Chromium other than the one this Playwright pins.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function render(source, width, height, path) {
  const page = await browser.newPage({ viewport: { width, height } });
  const sized = source.replace(/width="\d+" height="\d+"/, `width="${width}" height="${height}"`);
  await page.setContent(`<html><head><style>${fontFace}</style></head><body style="margin:0">${sized}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width, height } });
  await page.close();
}

const solid = svg("assets/brand/quaero-mark-solid.svg");
const mark = svg("assets/brand/quaero-mark.svg");
const appIcon = svg("assets/icons/quaero-app-icon.svg");

for (const s of [16, 32, 48, 64, 128, 256, 512]) {
  await render(s <= 32 ? solid : mark, s, s, `assets/brand/png/quaero-mark-${s}.png`);
}
await render(svg("assets/brand/quaero-wordmark.svg"), 708, 256, "assets/brand/png/quaero-wordmark.png");
await render(svg("assets/brand/quaero-wordmark-dark.svg"), 708, 256, "assets/brand/png/quaero-wordmark-dark.png");

const tmp = mkdtempSync(join(tmpdir(), "squaero-icons-"));
for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) {
  await render(s <= 32 ? solid : appIcon, s, s, join(tmp, `s${s}.png`));
}
await browser.close();
execFileSync(process.execPath, ["assets/icons/pack-icons.mjs", tmp, "assets/icons"], { stdio: "inherit" });
rmSync(tmp, { recursive: true });
