import { describe, it, expect } from "vitest";
import { moveSelection, scrollRowIntoView, isNavKey, PAGE_STEP } from "../../src/utils/gridNav";

describe("isNavKey", () => {
  it("recognizes the navigation keys", () => {
    for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]) {
      expect(isNavKey(k)).toBe(true);
    }
    expect(isNavKey("Enter")).toBe(false);
    expect(isNavKey("a")).toBe(false);
  });
});

describe("moveSelection", () => {
  it("selects the top-left cell from no selection on any nav key", () => {
    expect(moveSelection(null, "ArrowDown", 5, 3)).toEqual({ r: 0, c: 0 });
    expect(moveSelection(null, "ArrowUp", 5, 3)).toEqual({ r: 0, c: 0 });
  });

  it("moves within bounds and clamps at edges", () => {
    expect(moveSelection({ r: 1, c: 1 }, "ArrowDown", 5, 3)).toEqual({ r: 2, c: 1 });
    expect(moveSelection({ r: 1, c: 1 }, "ArrowRight", 5, 3)).toEqual({ r: 1, c: 2 });
    // clamp: cannot go above row 0 or left of col 0
    expect(moveSelection({ r: 0, c: 0 }, "ArrowUp", 5, 3)).toEqual({ r: 0, c: 0 });
    expect(moveSelection({ r: 0, c: 0 }, "ArrowLeft", 5, 3)).toEqual({ r: 0, c: 0 });
    // clamp: cannot go past the last row/col
    expect(moveSelection({ r: 4, c: 2 }, "ArrowDown", 5, 3)).toEqual({ r: 4, c: 2 });
    expect(moveSelection({ r: 4, c: 2 }, "ArrowRight", 5, 3)).toEqual({ r: 4, c: 2 });
  });

  it("Home/End jump to the first/last column", () => {
    expect(moveSelection({ r: 2, c: 1 }, "Home", 5, 4)).toEqual({ r: 2, c: 0 });
    expect(moveSelection({ r: 2, c: 1 }, "End", 5, 4)).toEqual({ r: 2, c: 3 });
  });

  it("PageUp/PageDown jump by PAGE_STEP rows, clamped", () => {
    expect(moveSelection({ r: 20, c: 0 }, "PageUp", 100, 2)).toEqual({ r: 20 - PAGE_STEP, c: 0 });
    expect(moveSelection({ r: 95, c: 0 }, "PageDown", 100, 2)).toEqual({ r: 99, c: 0 });
  });

  it("returns the selection unchanged for a non-nav key", () => {
    const s = { r: 1, c: 1 };
    expect(moveSelection(s, "Enter", 5, 3)).toBe(s);
  });

  it("returns null for an empty grid", () => {
    expect(moveSelection({ r: 0, c: 0 }, "ArrowDown", 0, 3)).toBeNull();
    expect(moveSelection(null, "ArrowDown", 5, 0)).toBeNull();
  });
});

describe("scrollRowIntoView", () => {
  const rowH = 28;
  const viewport = 280; // 10 rows

  it("returns null when the row is already fully visible", () => {
    // scrolled to top, row 3 spans [84,112] within [0,280]
    expect(scrollRowIntoView(3, rowH, 0, viewport)).toBeNull();
  });

  it("scrolls up to the row top when it is above the viewport", () => {
    // viewport starts at row 5 (140); row 2 is above → align its top (56)
    expect(scrollRowIntoView(2, rowH, 140, viewport)).toBe(56);
  });

  it("scrolls down so the row bottom meets the viewport bottom", () => {
    // row 12 bottom = 13*28 = 364; needs scrollTop = 364 - 280 = 84
    expect(scrollRowIntoView(12, rowH, 0, viewport)).toBe(84);
  });

  it("is a no-op on degenerate dimensions", () => {
    expect(scrollRowIntoView(3, 0, 0, viewport)).toBeNull();
    expect(scrollRowIntoView(3, rowH, 0, 0)).toBeNull();
  });
});
