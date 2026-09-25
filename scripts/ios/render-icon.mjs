// Renders the iPhone app's brand images (issue #579, task 7.1) from SVG with
// the Chromium Playwright already uses, so no image tool is needed:
//   node scripts/ios/render-icon.mjs      (run from the repo root, after
//                                           `pnpm install` in frontend/)
// - AppIcon.png: 1024×1024, opaque, from ios/Brand/AppIcon.svg
// - LaunchMark@{2,3}x.png: the brand mark (assets/brand/quaero-mark.svg) at 128 pt
// The PNGs are checked in; run this again only when a source SVG changes.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const icon = readFileSync("ios/Brand/AppIcon.svg", "utf8");
const mark = readFileSync("assets/brand/quaero-mark.svg", "utf8");
const catalog = "ios/Squaero/Assets.xcassets";

// CHROMIUM_PATH: a Chromium other than the one this Playwright pins.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function render(svg, size, path, transparent) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await page.setContent(`<html><body style="margin:0">${sized}</body></html>`);
  await page.screenshot({ path, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await render(icon, 1024, `${catalog}/AppIcon.appiconset/AppIcon.png`, false);
await render(mark, 256, `${catalog}/LaunchMark.imageset/LaunchMark@2x.png`, true);
await render(mark, 384, `${catalog}/LaunchMark.imageset/LaunchMark@3x.png`, true);
await browser.close();
