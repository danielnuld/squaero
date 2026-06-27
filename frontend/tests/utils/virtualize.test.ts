import { describe, it, expect } from "vitest";
import { visibleRange, needsMoreRows } from "../../src/utils/virtualize";

describe("visibleRange", () => {
  it("returns an empty range for an empty dataset", () => {
    expect(
      visibleRange({ scrollTop: 0, viewportHeight: 400, rowHeight: 24, rowCount: 0 }),
    ).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0 });
  });

  it("returns an empty range when rowHeight is non-positive", () => {
    expect(
      visibleRange({ scrollTop: 0, viewportHeight: 400, rowHeight: 0, rowCount: 100 }),
    ).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0 });
  });

  it("renders the top slice plus overscan at scrollTop 0", () => {
    const r = visibleRange({
      scrollTop: 0,
      viewportHeight: 240,
      rowHeight: 24,
      rowCount: 1000,
      overscan: 6,
    });
    expect(r.start).toBe(0);
    // 240/24 = 10 visible + 6 overscan below
    expect(r.end).toBe(16);
    expect(r.offsetY).toBe(0);
    expect(r.totalHeight).toBe(24000);
  });

  it("offsets the window when scrolled into the middle", () => {
    const r = visibleRange({
      scrollTop: 2400, // row 100
      viewportHeight: 240,
      rowHeight: 24,
      rowCount: 1000,
      overscan: 6,
    });
    expect(r.start).toBe(94); // 100 - 6 overscan
    expect(r.end).toBe(116); // 100 + 10 + 6
    expect(r.offsetY).toBe(94 * 24);
  });

  it("clamps the end to rowCount near the bottom", () => {
    const r = visibleRange({
      scrollTop: 1_000_000,
      viewportHeight: 240,
      rowHeight: 24,
      rowCount: 1000,
      overscan: 6,
    });
    expect(r.end).toBe(1000);
    expect(r.start).toBeLessThanOrEqual(1000);
  });

  it("renders only overscan rows when the viewport is unmeasured (height 0)", () => {
    const r = visibleRange({
      scrollTop: 0,
      viewportHeight: 0,
      rowHeight: 24,
      rowCount: 1000,
      overscan: 6,
    });
    expect(r.start).toBe(0);
    expect(r.end).toBe(6); // 0 visible + 6 overscan
    expect(r.totalHeight).toBe(24000);
  });

  it("treats negative scrollTop as the top", () => {
    const r = visibleRange({
      scrollTop: -50,
      viewportHeight: 240,
      rowHeight: 24,
      rowCount: 1000,
    });
    expect(r.start).toBe(0);
    expect(r.offsetY).toBe(0);
  });
});

describe("needsMoreRows", () => {
  it("is false when the dataset is not truncated", () => {
    expect(needsMoreRows(990, 1000, false, 50)).toBe(false);
  });

  it("is false with no rows loaded yet", () => {
    expect(needsMoreRows(0, 0, true, 50)).toBe(false);
  });

  it("is true when scrolled within the threshold of the last loaded row", () => {
    expect(needsMoreRows(960, 1000, true, 50)).toBe(true);
  });

  it("is false when still far from the end", () => {
    expect(needsMoreRows(800, 1000, true, 50)).toBe(false);
  });
});
