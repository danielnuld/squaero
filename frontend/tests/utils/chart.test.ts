import { describe, it, expect } from "vitest";
import {
  toNumber,
  defaultColumns,
  buildChartData,
  seriesMax,
  seriesMin,
  axisScale,
  seriesAreIntegers,
  labelLayout,
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

// Issue #386: the axis used to round the TOP and then cut it in four, so a
// maximum of 5 produced 0 / 1.25 / 2.5 / 3.75 / 5 over a count of customers.
describe("axisScale", () => {
  it("puts every tick on a number someone would say out loud", () => {
    expect(axisScale(100).ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(axisScale(7).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(axisScale(150).ticks).toEqual([0, 50, 100, 150]);
  });

  it("keeps whole data on whole ticks", () => {
    expect(axisScale(5, true).ticks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(axisScale(3, true).ticks).toEqual([0, 1, 2, 3]);
    // Fractional data keeps its fractions: forcing 1 there would flatten it.
    expect(axisScale(0.5).ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it("reaches at least as far as the data", () => {
    for (const max of [1, 3, 7, 12, 45, 150, 999]) {
      const s = axisScale(max);
      expect(s.max).toBeGreaterThanOrEqual(max);
      expect(s.ticks[s.ticks.length - 1]).toBe(s.max);
    }
  });

  it("says nothing about an empty or impossible axis", () => {
    expect(axisScale(0)).toEqual({ max: 0, ticks: [0] });
    expect(axisScale(-4)).toEqual({ max: 0, ticks: [0] });
    expect(axisScale(Number.NaN)).toEqual({ max: 0, ticks: [0] });
  });
});

describe("seriesAreIntegers", () => {
  it("is true only when nothing has a fraction", () => {
    expect(seriesAreIntegers([{ name: "n", values: [1, 2, 3] }])).toBe(true);
    expect(seriesAreIntegers([{ name: "n", values: [1, 2.5] }])).toBe(false);
    expect(seriesAreIntegers([])).toBe(true);
  });
});

// The labels used to be cut to nine characters: "Cd. Obregón" became
// "Cd. Obreg…" and "Agua Prieta" became "Agua Prie…".
describe("labelLayout", () => {
  const many = (n: number, text: string) => Array.from({ length: n }, () => text);

  it("leaves short labels flat", () => {
    expect(labelLayout(many(5, "sur"), 640)).toEqual({ rotate: false, stride: 1 });
  });

  it("tilts rather than truncates when the band is narrow", () => {
    expect(labelLayout(many(8, "Puerto Peñasco"), 640).rotate).toBe(true);
  });

  it("thins the labels out when even tilting will not fit them", () => {
    expect(labelLayout(many(200, "Hermosillo"), 640).stride).toBeGreaterThan(1);
  });

  it("has nothing to lay out with no labels", () => {
    expect(labelLayout([], 640)).toEqual({ rotate: false, stride: 1 });
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
