import { describe, it, expect } from "vitest";
import { compareResults, comparisonView, DIFF_MARK } from "../../src/utils/resultCompare";
import type { ResultSet } from "../../src/utils/query";

function rs(
  cols: [string, string][],
  rows: (string | null)[][],
  truncated = false,
): ResultSet {
  return { columns: cols.map(([name, type]) => ({ name, type })), rows, truncated, rowsAffected: 0 };
}
const C: [string, string][] = [
  ["id", "int"],
  ["name", "text"],
];
const byId = { by: "key" as const, columns: ["id"] };

describe("compareResults by key", () => {
  it("classifies added, removed and changed rows and counts the rest as same", () => {
    const left = rs(C, [["1", "a"], ["2", "b"], ["3", "c"]]);
    const right = rs(C, [["1", "a"], ["2", "B"], ["4", "d"]]);
    const cmp = compareResults(left, right, byId);
    expect(cmp.rows).toEqual([
      { status: "changed", left: 1, right: 1, changed: ["name"] },
      { status: "removed", left: 2, right: null, changed: [] },
      { status: "added", left: null, right: 2, changed: [] },
    ]);
    expect(cmp.same).toBe(1);
    expect(cmp.duplicateKeys).toBe(0);
  });

  it("pairs by key regardless of row order", () => {
    const cmp = compareResults(rs(C, [["1", "a"], ["2", "b"]]), rs(C, [["2", "b"], ["1", "a"]]), byId);
    expect(cmp.rows).toEqual([]);
    expect(cmp.same).toBe(2);
  });

  it("supports a composite key", () => {
    const cols: [string, string][] = [["a", "int"], ["b", "text"], ["v", "text"]];
    const left = rs(cols, [["1", "x", "old"], ["1", "y", "same"]]);
    const right = rs(cols, [["1", "y", "same"], ["1", "x", "new"], ["2", "x", "n"]]);
    const cmp = compareResults(left, right, { by: "key", columns: ["a", "b"] });
    expect(cmp.rows.map((r) => r.status)).toEqual(["changed", "added"]);
    expect(cmp.rows[0]).toMatchObject({ left: 0, right: 1, changed: ["v"] });
  });

  it("reports duplicate keys instead of collapsing them", () => {
    const left = rs(C, [["1", "a"], ["1", "a2"], ["2", "b"]]);
    const right = rs(C, [["1", "a"], ["2", "b"]]);
    const cmp = compareResults(left, right, byId);
    expect(cmp.duplicateKeys).toBe(1);
    expect(cmp.rows).toEqual([
      { status: "duplicate", left: 0, right: null, changed: [] },
      { status: "duplicate", left: 1, right: null, changed: [] },
      { status: "duplicate", left: null, right: 0, changed: [] },
    ]);
    expect(cmp.same).toBe(1);
  });

  it("keeps a NULL key distinct from the text 'NULL' and from empty", () => {
    const left = rs(C, [[null, "a"], ["", "b"]]);
    const right = rs([["id", "text"], ["name", "text"]], [["NULL", "a"], [null, "a"]]);
    const cmp = compareResults(left, right, byId);
    expect(cmp.same).toBe(1); // null ↔ null
    expect(cmp.rows.map((r) => r.status)).toEqual(["removed", "added"]);
  });

  it("refuses to compare when a key column is missing on a side", () => {
    const right = rs([["code", "int"], ["name", "text"]], [["1", "a"]]);
    const cmp = compareResults(rs(C, [["1", "a"]]), right, byId);
    expect(cmp.missingKey).toEqual(["id"]);
    expect(cmp.rows).toEqual([]);
    expect(cmp.same).toBe(0);
  });
});

describe("compareResults by position", () => {
  it("pairs row i with row i and reports the extra rows", () => {
    const cmp = compareResults(rs(C, [["1", "a"], ["2", "b"]]), rs(C, [["1", "x"], ["2", "b"], ["3", "c"]]), {
      by: "position",
    });
    expect(cmp.rows).toEqual([
      { status: "changed", left: 0, right: 0, changed: ["name"] },
      { status: "added", left: null, right: 2, changed: [] },
    ]);
    const shorter = compareResults(rs(C, [["1", "a"], ["2", "b"]]), rs(C, [["1", "a"]]), { by: "position" });
    expect(shorter.rows).toEqual([{ status: "removed", left: 1, right: null, changed: [] }]);
  });

  it("handles empty sides", () => {
    expect(compareResults(rs(C, []), rs(C, []), { by: "position" }).rows).toEqual([]);
    expect(compareResults(rs(C, []), rs(C, [["1", "a"]]), byId).rows).toEqual([
      { status: "added", left: null, right: 0, changed: [] },
    ]);
    expect(compareResults(rs(C, [["1", "a"]]), rs(C, []), byId).rows).toEqual([
      { status: "removed", left: 0, right: null, changed: [] },
    ]);
  });
});

describe("compareResults equality", () => {
  const pos = { by: "position" as const };
  const one = (type: string, a: string | null, b: string | null) =>
    compareResults(rs([["v", type]], [[a]]), rs([["v", type]], [[b]]), pos).same === 1;

  it("compares numbers by value, exactly", () => {
    expect(one("int", "1.0", "1")).toBe(true);
    expect(one("float", "01.50", "1.5")).toBe(true);
    expect(one("float", "-0", "0")).toBe(true);
    expect(one("float", "1e3", "1000")).toBe(true);
    expect(one("int", "12345678901234567890", "12345678901234567891")).toBe(false);
    expect(one("int", "1", "2")).toBe(false);
  });

  it("reads booleans the way the grid does", () => {
    expect(one("bool", "t", "true")).toBe(true);
    expect(one("bool", "1", "false")).toBe(false);
  });

  it("compares other types as exact text", () => {
    expect(one("text", "1.0", "1")).toBe(false);
    expect(one("text", "a", "A")).toBe(false);
    expect(one("text", "a ", "a")).toBe(false);
  });

  it("treats NULL and empty text as different", () => {
    expect(one("text", null, "")).toBe(false);
    expect(one("int", null, "0")).toBe(false);
    expect(one("text", null, null)).toBe(true);
  });

  it("falls back to text when the sides disagree on the column's type", () => {
    const cmp = compareResults(rs([["v", "int"]], [["1.0"]]), rs([["v", "text"]], [["1"]]), pos);
    expect(cmp.same).toBe(0);
  });
});

describe("compareResults columns and limits", () => {
  it("compares the shared columns and reports the others", () => {
    const left = rs([["id", "int"], ["a", "text"], ["old", "text"]], [["1", "x", "o"]]);
    const right = rs([["new", "text"], ["a", "text"], ["id", "int"]], [["n", "x", "1"]]);
    const cmp = compareResults(left, right, byId);
    expect(cmp.columns).toEqual(["id", "a"]);
    expect(cmp.onlyLeft).toEqual(["old"]);
    expect(cmp.onlyRight).toEqual(["new"]);
    expect(cmp.same).toBe(1);
  });

  it("says how many rows each side had loaded and whether more existed", () => {
    const cmp = compareResults(rs(C, [["1", "a"]], true), rs(C, [["1", "a"], ["2", "b"]]), byId);
    expect(cmp.loaded).toEqual({ left: 1, right: 2 });
    expect(cmp.truncated).toEqual({ left: true, right: false });
  });
});

describe("comparisonView", () => {
  it("draws a status column, the side's values and old → new for a changed cell", () => {
    const left = rs(C, [["1", "a"], ["2", null], ["3", "c"]]);
    const right = rs(C, [["1", "a"], ["2", "B"], ["4", "d"]]);
    const v = comparisonView(compareResults(left, right, byId), left, right, "Δ");
    expect(v.result.columns).toEqual([
      { name: "Δ", type: "text" },
      { name: "id", type: "int" },
      { name: "name", type: "text" },
    ]);
    expect(v.result.rows).toEqual([
      [DIFF_MARK.changed, "2", "NULL → B"],
      [DIFF_MARK.removed, "3", "c"],
      [DIFF_MARK.added, "4", "d"],
    ]);
    expect(v.status).toEqual(["changed", "removed", "added"]);
    expect(v.changed.map((s) => [...s])).toEqual([[2], [], []]);
  });
});
