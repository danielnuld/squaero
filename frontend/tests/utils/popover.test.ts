import { describe, it, expect } from "vitest";
import { placeBelow } from "../../src/utils/popover";

const viewport = { width: 1000, height: 600 };
const anchor = { left: 100, top: 100, width: 80, height: 24 };

describe("placeBelow", () => {
  it("opens under the anchor, aligned to its left edge", () => {
    const p = placeBelow({ anchor, size: { width: 120, height: 200 }, viewport });
    expect(p).toEqual({ x: 100, y: 128, above: false });
  });

  it("centres under the anchor when asked", () => {
    const p = placeBelow({ anchor, size: { width: 40, height: 20 }, viewport, align: "center" });
    expect(p.x).toBe(120);
  });

  it("flips above when the bottom is in the way and there is more room up there", () => {
    const low = { ...anchor, top: 500 };
    const p = placeBelow({ anchor: low, size: { width: 120, height: 200 }, viewport });
    expect(p.above).toBe(true);
    expect(p.y).toBe(500 - 4 - 200);
  });

  it("stays below, clamped, when there is no more room above than below", () => {
    const mid = { ...anchor, top: 280 };
    const p = placeBelow({ anchor: mid, size: { width: 120, height: 500 }, viewport });
    expect(p.above).toBe(false);
    expect(p.y).toBe(600 - 500 - 4);
  });

  it("slides left so a wide box never leaves the window", () => {
    const right = { ...anchor, left: 950 };
    const p = placeBelow({ anchor: right, size: { width: 200, height: 50 }, viewport });
    expect(p.x).toBe(1000 - 200 - 4);
  });

  it("never goes past the top-left margin, even for a box larger than the window", () => {
    const p = placeBelow({ anchor, size: { width: 2000, height: 2000 }, viewport, margin: 10 });
    expect(p).toMatchObject({ x: 10, y: 10 });
  });

  it("honours a custom gap", () => {
    const p = placeBelow({ anchor, size: { width: 10, height: 10 }, viewport, gap: 12 });
    expect(p.y).toBe(100 + 24 + 12);
  });
});
