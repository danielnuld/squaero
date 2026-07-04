import { describe, it, expect } from "vitest";
import {
  isNumericType,
  cycleSort,
  compareValues,
  buildViewIndices,
  sortGlyph,
  type SortState,
} from "../../src/utils/gridView";
import type { ResultColumn } from "../../src/utils/query";

const cols = (types: string[]): ResultColumn[] => types.map((t, i) => ({ name: `c${i}`, type: t }));

describe("isNumericType", () => {
  it("recognizes the numeric neutral types the core sends (int/float)", () => {
    expect(isNumericType("int")).toBe(true);
    expect(isNumericType("FLOAT")).toBe(true);
    expect(isNumericType("text")).toBe(false);
    expect(isNumericType("timestamp")).toBe(false);
    expect(isNumericType("")).toBe(false);
  });
});

describe("cycleSort", () => {
  it("cycles none -> asc -> desc -> none on the same column", () => {
    let s: SortState | null = null;
    s = cycleSort(s, 2);
    expect(s).toEqual({ col: 2, dir: "asc" });
    s = cycleSort(s, 2);
    expect(s).toEqual({ col: 2, dir: "desc" });
    s = cycleSort(s, 2);
    expect(s).toBeNull();
  });

  it("switching columns restarts at asc", () => {
    expect(cycleSort({ col: 1, dir: "desc" }, 3)).toEqual({ col: 3, dir: "asc" });
  });
});

describe("compareValues", () => {
  it("sorts NULLs last regardless of type", () => {
    expect(compareValues(null, "x", false)).toBe(1);
    expect(compareValues("x", null, false)).toBe(-1);
    expect(compareValues(null, null, false)).toBe(0);
  });

  it("compares numerically for numeric columns (not lexically)", () => {
    expect(compareValues("9", "10", true)).toBeLessThan(0); // 9 < 10
    expect(compareValues("9", "10", false)).toBeGreaterThan(0); // "9" > "10" lexically
  });

  it("orders non-numeric text after numbers in a numeric column", () => {
    expect(compareValues("5", "abc", true)).toBeLessThan(0);
    expect(compareValues("abc", "5", true)).toBeGreaterThan(0);
  });
});

describe("buildViewIndices", () => {
  const rows = [
    ["2", "banana"],
    ["10", "apple"],
    ["1", null],
  ];
  const c = cols(["int", "text"]);

  it("is the identity order with no sort or filter", () => {
    expect(buildViewIndices(rows, c, null, {})).toEqual([0, 1, 2]);
  });

  it("sorts numerically ascending/descending by the numeric column", () => {
    expect(buildViewIndices(rows, c, { col: 0, dir: "asc" }, {})).toEqual([2, 0, 1]);
    expect(buildViewIndices(rows, c, { col: 0, dir: "desc" }, {})).toEqual([1, 0, 2]);
  });

  it("sorts text with NULLs last", () => {
    expect(buildViewIndices(rows, c, { col: 1, dir: "asc" }, {})).toEqual([1, 0, 2]);
  });

  it("filters case-insensitively per column; NULL never matches", () => {
    expect(buildViewIndices(rows, c, null, { 1: "AP" })).toEqual([1]);
    expect(buildViewIndices(rows, c, null, { 1: "z" })).toEqual([]);
  });

  it("applies filter then sort", () => {
    const rows2 = [
      ["3", "x"],
      ["1", "x"],
      ["2", "y"],
    ];
    // keep only "x" rows, then sort by col0 asc -> original indices [1,0]
    expect(buildViewIndices(rows2, cols(["int", "text"]), { col: 0, dir: "asc" }, { 1: "x" })).toEqual([
      1, 0,
    ]);
  });

  it("is stable for equal keys", () => {
    const rows3 = [
      ["1", "a"],
      ["1", "b"],
      ["1", "c"],
    ];
    expect(buildViewIndices(rows3, cols(["int", "text"]), { col: 0, dir: "asc" }, {})).toEqual([0, 1, 2]);
  });
});

describe("sortGlyph", () => {
  it("shows the arrow only for the active column", () => {
    expect(sortGlyph({ col: 1, dir: "asc" }, 1)).toBe("▲");
    expect(sortGlyph({ col: 1, dir: "desc" }, 1)).toBe("▼");
    expect(sortGlyph({ col: 1, dir: "asc" }, 0)).toBe("");
    expect(sortGlyph(null, 0)).toBe("");
  });
});
