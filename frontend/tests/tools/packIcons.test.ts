import { describe, it, expect } from "vitest";
// The icon packer lives outside src/ (dev-only packaging), but its hand-rolled
// ICO/ICNS container builders are pure and worth covering (issue #190).
import { buildIco, buildIcns, ICNS_TYPES } from "../../../assets/icons/pack-icons.mjs";

describe("buildIco", () => {
  it("assembles a valid ICONDIR with per-image entries and offsets", () => {
    const imgs = [
      { size: 16, data: Buffer.from([1, 2, 3, 4]) },
      { size: 256, data: Buffer.from([5, 6, 7, 8, 9, 10]) },
    ];
    const ico = buildIco(imgs);

    // Header: reserved 0, type 1 (icon), count 2.
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);

    const dataStart = 6 + 16 * 2;
    // Entry 0: 16px, 32bpp, 1 plane, 4 bytes, offset right after the directory.
    expect(ico.readUInt8(6)).toBe(16); // width
    expect(ico.readUInt8(7)).toBe(16); // height
    expect(ico.readUInt16LE(6 + 4)).toBe(1); // planes
    expect(ico.readUInt16LE(6 + 6)).toBe(32); // bit count
    expect(ico.readUInt32LE(6 + 8)).toBe(4); // bytes in resource
    expect(ico.readUInt32LE(6 + 12)).toBe(dataStart);

    // Entry 1: 256px encoded as width/height byte 0.
    expect(ico.readUInt8(22)).toBe(0);
    expect(ico.readUInt32LE(22 + 8)).toBe(6);
    expect(ico.readUInt32LE(22 + 12)).toBe(dataStart + 4);

    // Payloads appended verbatim, total length adds up.
    expect(ico.length).toBe(dataStart + 4 + 6);
    expect(ico.subarray(dataStart, dataStart + 4)).toEqual(imgs[0].data);
    expect(ico.subarray(dataStart + 4)).toEqual(imgs[1].data);
  });
});

describe("buildIcns", () => {
  it("wraps each PNG in a typed block under the icns header", () => {
    const imgs = [
      { size: 16, data: Buffer.from([1, 2, 3]) },
      { size: 32, data: Buffer.from([4, 5]) },
    ];
    const icns = buildIcns(imgs);

    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    // Total length field equals the actual buffer length.
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(icns.length).toBe(8 + (8 + 3) + (8 + 2));

    // Block 0: type icp4 (16px), length includes its 8-byte header.
    expect(icns.toString("ascii", 8, 12)).toBe(ICNS_TYPES[16]);
    expect(icns.readUInt32BE(12)).toBe(8 + 3);

    // Block 1 follows immediately: type icp5 (32px).
    const b1 = 8 + (8 + 3);
    expect(icns.toString("ascii", b1, b1 + 4)).toBe(ICNS_TYPES[32]);
    expect(icns.readUInt32BE(b1 + 4)).toBe(8 + 2);
  });

  it("throws for a size with no ICNS type code", () => {
    expect(() => buildIcns([{ size: 48, data: Buffer.from([0]) }])).toThrow();
  });
});
