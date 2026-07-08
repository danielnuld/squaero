import { describe, it, expect } from "vitest";
import {
  computeColumnWidths,
  resizeColumn,
  MIN_COL_WIDTH,
  MAX_AUTO_WIDTH,
} from "../../src/utils/gridColumns";

describe("computeColumnWidths", () => {
  const opts = { charPx: 10, padPx: 20, min: 60, maxAuto: 400 };

  it("sizes a column from the longest of header and sampled cells", () => {
    const cols = [{ name: "id", type: "int" }];
    const rows = [["1"], ["222"], ["55555"]]; // longest cell = 5 chars
    // max(len) = 5 -> 5*10 + 20 = 70
    expect(computeColumnWidths(cols, rows, opts)).toEqual([70]);
  });

  it("uses the header name when it is longer than any cell", () => {
    const cols = [{ name: "description", type: "text" }]; // 11 chars
    const rows = [["hi"], ["yo"]];
    // 11*10 + 20 = 130
    expect(computeColumnWidths(cols, rows, opts)).toEqual([130]);
  });

  it("counts NULL as its rendered 'NULL' text (4 chars)", () => {
    const cols = [{ name: "x", type: "text" }];
    const rows = [[null], [null]];
    // max(len(name)=1, 4) = 4 -> 4*10 + 20 = 60
    expect(computeColumnWidths(cols, rows, opts)).toEqual([60]);
  });

  it("clamps to the minimum for tiny content", () => {
    const cols = [{ name: "a", type: "" }];
    const rows = [["b"]];
    // 1*10 + 20 = 30 -> clamped to min 60
    expect(computeColumnWidths(cols, rows, opts)).toEqual([60]);
  });

  it("clamps to maxAuto for very long content", () => {
    const cols = [{ name: "blob", type: "text" }];
    const rows = [["x".repeat(1000)]];
    expect(computeColumnWidths(cols, rows, opts)).toEqual([400]);
  });

  it("only samples the leading rows", () => {
    const cols = [{ name: "c", type: "" }];
    // A long value beyond the sample window must not widen the column.
    const rows = [["ab"], ["cd"], ["x".repeat(50)]];
    const got = computeColumnWidths(cols, rows, { ...opts, sample: 2 });
    // sampled max len = 2 -> 2*10 + 20 = 40 -> clamped to 60
    expect(got).toEqual([60]);
  });

  it("handles an empty result and multiple columns independently", () => {
    const cols = [
      { name: "short", type: "int" }, // 5
      { name: "much_longer_name", type: "text" }, // 16
    ];
    expect(computeColumnWidths(cols, [], opts)).toEqual([70, 180]);
  });

  it("respects the default clamps without options", () => {
    const cols = [{ name: "n", type: "" }];
    const [w] = computeColumnWidths(cols, [["z".repeat(9999)]]);
    expect(w).toBe(MAX_AUTO_WIDTH);
    const [w2] = computeColumnWidths([{ name: "", type: "" }], [[""]]);
    expect(w2).toBe(MIN_COL_WIDTH);
  });
});

describe("resizeColumn", () => {
  it("adds the delta to the target column and rounds", () => {
    expect(resizeColumn([100, 200], 0, 25)).toEqual([125, 200]);
    expect(resizeColumn([100, 200], 1, -30)).toEqual([100, 170]);
  });

  it("clamps to the minimum width", () => {
    expect(resizeColumn([100], 0, -500, 60)).toEqual([60]);
  });

  it("ignores out-of-range indices and non-finite deltas", () => {
    const w = [100, 200];
    expect(resizeColumn(w, 5, 10)).toBe(w);
    expect(resizeColumn(w, -1, 10)).toBe(w);
    expect(resizeColumn(w, 0, NaN)).toBe(w);
  });

  it("does not mutate the input array", () => {
    const w = [100, 200];
    const out = resizeColumn(w, 0, 10);
    expect(w).toEqual([100, 200]);
    expect(out).not.toBe(w);
  });
});
