import { describe, it, expect } from "vitest";
import {
  toNumber,
  defaultColumns,
  buildChartData,
  seriesMax,
  seriesMin,
  niceMax,
  axisTicks,
  pieSlices,
  arcPath,
} from "../../src/utils/chart";
import type { ResultSet } from "../../src/utils/query";

const result: ResultSet = {
  columns: [
    { name: "month", type: "text" },
    { name: "sales", type: "int" },
    { name: "cost", type: "float" },
  ],
  rows: [
    ["Jan", "100", "40"],
    ["Feb", "150", "x"],
    ["Mar", null, "60"],
  ],
  truncated: false,
  rowsAffected: 0,
};

describe("toNumber", () => {
  it("parses finite numbers, else null", () => {
    expect(toNumber("42")).toBe(42);
    expect(toNumber(" 3.5 ")).toBe(3.5);
    expect(toNumber("")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber("abc")).toBeNull();
  });
});

describe("defaultColumns", () => {
  it("picks the first text column as label and first numeric as value", () => {
    expect(defaultColumns(result)).toEqual({ labelCol: 0, valueCols: [1] });
  });
  it("falls back to column 0 and no series when all numeric / none numeric", () => {
    const allNum: ResultSet = {
      columns: [{ name: "a", type: "int" }, { name: "b", type: "int" }],
      rows: [], truncated: false, rowsAffected: 0,
    };
    expect(defaultColumns(allNum)).toEqual({ labelCol: 0, valueCols: [0] });
    const noNum: ResultSet = {
      columns: [{ name: "a", type: "text" }],
      rows: [], truncated: false, rowsAffected: 0,
    };
    expect(defaultColumns(noNum)).toEqual({ labelCol: 0, valueCols: [] });
  });
});

describe("buildChartData", () => {
  it("extracts labels and numeric series, NULL/non-numeric -> 0", () => {
    const data = buildChartData(result, 0, [1, 2]);
    expect(data.labels).toEqual(["Jan", "Feb", "Mar"]);
    expect(data.series).toEqual([
      { name: "sales", values: [100, 150, 0] }, // Mar sales NULL -> 0
      { name: "cost", values: [40, 0, 60] }, // Feb cost "x" -> 0
    ]);
  });
  it("renders a NULL label as the empty glyph", () => {
    const r: ResultSet = {
      columns: [{ name: "k", type: "text" }, { name: "v", type: "int" }],
      rows: [[null, "5"]], truncated: false, rowsAffected: 0,
    };
    expect(buildChartData(r, 0, [1]).labels).toEqual(["∅"]);
  });
});

describe("seriesMax / seriesMin", () => {
  const series = [
    { name: "a", values: [1, -3, 5] },
    { name: "b", values: [2, 4, -1] },
  ];
  it("spans all series", () => {
    expect(seriesMax(series)).toBe(5);
    expect(seriesMin(series)).toBe(-3);
  });
  it("min floors at 0 for all-positive data", () => {
    expect(seriesMin([{ name: "a", values: [1, 2] }])).toBe(0);
    expect(seriesMax([])).toBe(0);
  });
});

describe("niceMax / axisTicks", () => {
  it("rounds up to 1/2/5 x 10^n", () => {
    expect(niceMax(0)).toBe(0);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(150)).toBe(200);
    expect(niceMax(45)).toBe(50);
    expect(niceMax(1)).toBe(1);
  });
  it("produces evenly spaced ticks", () => {
    expect(axisTicks(100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(axisTicks(0)).toEqual([0]);
  });
});

describe("pieSlices / arcPath", () => {
  it("splits into fractions summing the circle, clamping negatives", () => {
    const slices = pieSlices([1, 3]);
    expect(slices[0].frac).toBeCloseTo(0.25);
    expect(slices[1].frac).toBeCloseTo(0.75);
    // starts at -90 deg, contiguous, ends at +270 deg
    expect(slices[0].start).toBeCloseTo(-Math.PI / 2);
    expect(slices[1].end).toBeCloseTo(-Math.PI / 2 + 2 * Math.PI);
    // negative clamped to 0
    expect(pieSlices([-5, 5])[0].frac).toBe(0);
  });
  it("zero total yields zero-width slices", () => {
    expect(pieSlices([0, 0]).every((s) => s.frac === 0)).toBe(true);
  });
  it("arcPath returns a move+arc path string", () => {
    const d = arcPath(50, 50, 40, -Math.PI / 2, 0);
    expect(d.startsWith("M 50 50")).toBe(true);
    expect(d).toContain("A 40 40");
  });
});
