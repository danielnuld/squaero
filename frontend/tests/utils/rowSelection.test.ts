import { describe, it, expect } from "vitest";
import {
  toggleMark,
  markRange,
  orderedMarks,
  pickRows,
} from "../../src/utils/rowSelection";
import type { ResultSet } from "../../src/utils/query";

// A view of 4 rows shown in reverse order (as a descending sort would leave it).
const view = [3, 2, 1, 0];

const result: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
  ],
  rows: [
    ["1", "Ana"],
    ["2", "Beto"],
    ["3", null],
  ],
  truncated: true,
  rowsAffected: 0,
};

describe("toggleMark", () => {
  it("adds a row that was not marked", () => {
    expect([...toggleMark(new Set([1]), 4)]).toEqual([1, 4]);
  });

  it("removes a row that was marked", () => {
    expect([...toggleMark(new Set([1, 4]), 4)]).toEqual([1]);
  });

  it("does not mutate the input", () => {
    const marks = new Set([1]);
    toggleMark(marks, 2);
    expect([...marks]).toEqual([1]);
  });
});

describe("markRange", () => {
  it("marks the original rows between two view positions", () => {
    expect([...markRange(new Set(), view, 1, 2)].sort()).toEqual([1, 2]);
  });

  it("works with the positions given backwards", () => {
    expect([...markRange(new Set(), view, 2, 1)].sort()).toEqual([1, 2]);
  });

  it("replaces earlier marks by default", () => {
    expect([...markRange(new Set([9]), view, 0, 0)]).toEqual([3]);
  });

  it("keeps earlier marks when additive", () => {
    expect([...markRange(new Set([9]), view, 0, 0, true)].sort()).toEqual([3, 9]);
  });

  it("clamps positions outside the view", () => {
    expect([...markRange(new Set(), view, -5, 99)].sort()).toEqual([0, 1, 2, 3]);
  });

  it("is empty for an empty view", () => {
    expect([...markRange(new Set(), [], 0, 3)]).toEqual([]);
  });
});

describe("orderedMarks", () => {
  it("returns marked rows in view order, not set order", () => {
    expect(orderedMarks(new Set([0, 3]), view)).toEqual([3, 0]);
  });

  it("drops marks the current filter hides", () => {
    expect(orderedMarks(new Set([0, 7]), view)).toEqual([0]);
  });

  it("is empty with nothing marked", () => {
    expect(orderedMarks(new Set(), view)).toEqual([]);
  });
});

describe("pickRows", () => {
  it("keeps only the given rows, in the given order", () => {
    expect(pickRows(result, [2, 0]).rows).toEqual([["3", null], ["1", "Ana"]]);
  });

  it("keeps the columns and clears truncated", () => {
    const subset = pickRows(result, [0]);
    expect(subset.columns).toBe(result.columns);
    expect(subset.truncated).toBe(false);
  });

  it("ignores out-of-range indices", () => {
    expect(pickRows(result, [1, 99, -1]).rows).toEqual([["2", "Beto"]]);
  });

  it("does not mutate the source result", () => {
    pickRows(result, [0]);
    expect(result.rows).toHaveLength(3);
  });
});
