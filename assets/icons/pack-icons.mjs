#!/usr/bin/env node
// Reproducible packer for the Quaero application icons (issue #190).
//
// Input: a directory of square PNG rasterizations of the brand mark named
//   s<size>.png (s16.png, s32.png, ...). These come from the brand source
//   assets/brand/quaero-mark-solid.svg — rasterize with any SVG tool, e.g.
//   `rsvg-convert -w 256 -h 256 quaero-mark-solid.svg > s256.png`.
//
// Output (into the target dir, default assets/icons/):
//   quaero.ico   — Windows multi-resolution icon (PNG-compressed entries,
//                  read by Windows Vista+; embedded in quaero.exe via the .rc)
//   quaero.icns  — macOS icon (PNG entries)
//   hicolor/<n>x<n>/apps/quaero.png — Linux hicolor theme PNGs
//
// No third-party dependencies: the ICO/ICNS containers are assembled by hand
// and the PNG payloads are embedded verbatim. The container builders
// (buildIco/buildIcns) are pure and unit-tested (frontend/tests/tools).
//
// Usage: node pack-icons.mjs [srcDir] [outDir]

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ICO_SIZES = [16, 32, 48, 64, 128, 256];
export const ICNS_SIZES = [16, 32, 64, 128, 256, 512];
export const HICOLOR_SIZES = [16, 32, 48, 64, 128, 256, 512];

// macOS ICNS OSType codes for square PNG icons, by pixel size.
export const ICNS_TYPES = { 16: "icp4", 32: "icp5", 64: "icp6", 128: "ic07", 256: "ic08", 512: "ic09" };

// --- Windows .ico (PNG entries) -------------------------------------------
// images: [{ size, data:Buffer }]. Pure — assembles the ICONDIR + entries +
// concatenated PNG payloads.
export function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const e = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0); // width (0 == 256)
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1); // height
    dir.writeUInt8(0, e + 2); // palette
    dir.writeUInt8(0, e + 3); // reserved
    dir.writeUInt16LE(1, e + 4); // planes
    dir.writeUInt16LE(32, e + 6); // bit count
    dir.writeUInt32LE(img.data.length, e + 8); // bytes in resource
    dir.writeUInt32LE(offset, e + 12); // offset
    offset += img.data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

// --- macOS .icns (PNG entries) --------------------------------------------
// images: [{ size, data:Buffer }]. Pure — each block is [OSType(4)][len(4, BE,
// includes the 8-byte header)][png], wrapped in the top-level icns header.
export function buildIcns(images) {
  const blocks = images.map(({ size, data }) => {
    const type = ICNS_TYPES[size];
    if (!type) throw new Error(`no ICNS type for size ${size}`);
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(blocks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

// --- CLI (file I/O; runs only when invoked directly) ----------------------
function loadPng(srcDir, size) {
  const buf = readFileSync(join(srcDir, `s${size}.png`));
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`s${size}.png is not a PNG`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== size || h !== size) throw new Error(`s${size}.png is ${w}x${h}, expected ${size}`);
  return buf;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcDir = process.argv[2] ?? join(here, "src");
  const outDir = process.argv[3] ?? here;

  const ico = ICO_SIZES.map((size) => ({ size, data: loadPng(srcDir, size) }));
  const icns = ICNS_SIZES.map((size) => ({ size, data: loadPng(srcDir, size) }));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "quaero.ico"), buildIco(ico));
  writeFileSync(join(outDir, "quaero.icns"), buildIcns(icns));
  for (const s of HICOLOR_SIZES) {
    const dst = join(outDir, "hicolor", `${s}x${s}`, "apps");
    mkdirSync(dst, { recursive: true });
    copyFileSync(join(srcDir, `s${s}.png`), join(dst, "quaero.png"));
  }
  console.log(
    `icons written to ${outDir} (ico ${ICO_SIZES.length} sizes, icns ${ICNS_SIZES.length} sizes, hicolor ${HICOLOR_SIZES.length} sizes)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
