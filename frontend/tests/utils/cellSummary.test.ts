import { describe, it, expect } from "vitest";
import { summarizeCells } from "../../src/utils/cellSummary";

// Issue #670: the status bar sums up the selected cells.
describe("summarizeCells", () => {
  it("is all zeros for an empty selection", () => {
    expect(summarizeCells([], "int")).toEqual({ count: 0, nulls: 0 });
  });

  it("summarizes a single cell", () => {
    expect(summarizeCells(["42"], "int")).toEqual({
      count: 1,
      nulls: 0,
      sum: "42",
      avg: "42",
      min: "42",
      max: "42",
    });
  });

  it("adds decimals exactly, without float noise", () => {
    const s = summarizeCells(["0.1", "0.2"], "float");
    expect(s.sum).toBe("0.3");
    expect(s.avg).toBe("0.15");
  });

  it("keeps the column's scale in the sum and average", () => {
    const s = summarizeCells(["1.50", "2.50"], "float");
    expect(s.sum).toBe("4.00");
    expect(s.avg).toBe("2.00");
  });

  it("rounds a repeating average to a fixed number of digits", () => {
    expect(summarizeCells(["1", "2", "2"], "int").avg).toBe("1.6666666667");
    expect(summarizeCells(["-1", "-2", "-2"], "int").avg).toBe("-1.6666666667");
  });

  it("sums big integers past the float range without losing digits", () => {
    const s = summarizeCells(["9007199254740993", "1"], "int");
    expect(s.sum).toBe("9007199254740994");
    expect(s.max).toBe("9007199254740993");
  });

  it("handles negative numbers", () => {
    const s = summarizeCells(["-5", "3", "-0.5"], "float");
    expect(s.sum).toBe("-2.5");
    expect(s.min).toBe("-5");
    expect(s.max).toBe("3");
    expect(summarizeCells(["-1", "1"], "int").sum).toBe("0");
  });

  it("reads scientific notation a float column may send", () => {
    const s = summarizeCells(["1e-5", "1.5E+3"], "float");
    expect(s.sum).toBe("1500.00001");
    expect(s.min).toBe("1e-5");
  });

  it("skips NULLs in the statistics but counts them", () => {
    const s = summarizeCells(["10", null, "20"], "int");
    expect(s).toMatchObject({ count: 3, nulls: 1, sum: "30", avg: "15", min: "10", max: "20" });
  });

  it("gives only a count when every cell is NULL", () => {
    expect(summarizeCells([null, null], "int")).toEqual({ count: 2, nulls: 2 });
  });

  it("gives only a count when a numeric column holds non-numeric text", () => {
    expect(summarizeCells(["1", "NaN"], "float")).toEqual({ count: 2, nulls: 0 });
    expect(summarizeCells(["1", "abc"], "int")).toEqual({ count: 2, nulls: 0 });
    expect(summarizeCells(["."], "float")).toEqual({ count: 1, nulls: 0 });
  });

  it("never treats a text column as numbers, whatever it holds", () => {
    expect(summarizeCells(["1", "2"], "text")).toEqual({ count: 2, nulls: 0 });
    expect(summarizeCells(["1", "0"], "bool")).toEqual({ count: 2, nulls: 0 });
  });

  it("gives the range of ISO dates and times", () => {
    expect(summarizeCells(["2024-03-01", null, "2023-12-31"], "date")).toEqual({
      count: 3,
      nulls: 1,
      min: "2023-12-31",
      max: "2024-03-01",
    });
    expect(summarizeCells(["2024-01-01 10:00:00", "2024-01-01 09:30:00"], "timestamp")).toMatchObject({
      min: "2024-01-01 09:30:00",
      max: "2024-01-01 10:00:00",
    });
    expect(summarizeCells(["23:59", "00:01"], "time")).toMatchObject({ min: "00:01", max: "23:59" });
  });

  it("gives only a count for dates it cannot order", () => {
    expect(summarizeCells(["02/14/2023", "01/01/2024"], "date")).toEqual({ count: 2, nulls: 0 });
  });
});
