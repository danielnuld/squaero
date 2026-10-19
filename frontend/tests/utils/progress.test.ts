import { describe, it, expect } from "vitest";
import { etaParts, progressFacts } from "../../src/utils/progress";

describe("progressFacts", () => {
  it("works out percent, what is left and the time left", () => {
    expect(progressFacts(2140, 4812, 6000)).toEqual({ percent: 44, remaining: 2672, etaMs: 7492 });
  });
  it("has no estimate before the first item", () => {
    expect(progressFacts(0, 10, 500)).toEqual({ percent: 0, remaining: 10, etaMs: null });
    expect(progressFacts(3, 10, 0).etaMs).toBeNull();
  });
  it("is indeterminate without a total", () => {
    expect(progressFacts(5, null, 100)).toEqual({ percent: null, remaining: null, etaMs: null });
    expect(progressFacts(5, 0, 100).percent).toBeNull();
  });
  it("clamps a count past the total", () => {
    expect(progressFacts(12, 10, 100)).toEqual({ percent: 100, remaining: 0, etaMs: 0 });
    expect(progressFacts(-1, 10, 100).percent).toBe(0);
  });
});

describe("etaParts", () => {
  it("rounds up to what a person says", () => {
    expect(etaParts(7492)).toEqual({ n: 8, unit: "s" });
    expect(etaParts(0)).toEqual({ n: 1, unit: "s" });
    expect(etaParts(61000)).toEqual({ n: 2, unit: "min" });
    expect(etaParts(3600 * 1000 * 2.5)).toEqual({ n: 3, unit: "h" });
  });
});
