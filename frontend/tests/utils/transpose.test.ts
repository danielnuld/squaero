import { describe, it, expect } from "vitest";
import { transposeResult, TRANSPOSE_MAX_ROWS } from "../../src/utils/transpose";
import type { ResultSet } from "../../src/utils/query";

const headers = { column: "column", type: "type", row: (r: number) => `row ${r + 1}` };

const source: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
    { name: "born", type: "date" },
  ],
  rows: [
    ["1", "Ana", "1990-01-02"],
    ["2", null, null],
    ["3", "Luis", "2001-05-06"],
  ],
  truncated: true,
  rowsAffected: 0,
};

// Issue #670: wide results read better with columns as rows.
describe("transposeResult", () => {
  it("turns the chosen rows into columns, in the given order", () => {
    const t = transposeResult(source, [2, 0], headers);
    expect(t.result.columns.map((c) => c.name)).toEqual(["column", "type", "row 3", "row 1"]);
    expect(t.result.rows).toEqual([
      ["id", "int", "3", "1"],
      ["name", "text", "Luis", "Ana"],
      ["born", "date", "2001-05-06", "1990-01-02"],
    ]);
    expect(t.result.truncated).toBe(false);
    expect(t.capped).toBe(false);
  });

  it("keeps each source column's type for formatting, and NULL as NULL", () => {
    const t = transposeResult(source, [1], headers);
    expect(t.types).toEqual(["int", "text", "date"]);
    expect(t.result.rows[1]).toEqual(["name", "text", null]);
  });

  it("transposes the whole page when no rows are chosen", () => {
    const t = transposeResult(source, [], headers);
    expect(t.result.columns).toHaveLength(2 + 3);
  });

  it("ignores row indices outside the result", () => {
    const t = transposeResult(source, [7, -1, 1], headers);
    expect(t.result.columns.map((c) => c.name)).toEqual(["column", "type", "row 2"]);
  });

  it("caps the page so the grid does not grow a column per row", () => {
    const big: ResultSet = {
      ...source,
      rows: Array.from({ length: TRANSPOSE_MAX_ROWS + 5 }, (_, i) => [String(i), "x", null]),
    };
    const t = transposeResult(big, [], headers);
    expect(t.result.columns).toHaveLength(2 + TRANSPOSE_MAX_ROWS);
    expect(t.capped).toBe(true);
  });

  it("handles a result with no rows", () => {
    const t = transposeResult({ ...source, rows: [] }, [], headers);
    expect(t.result.columns).toHaveLength(2);
    expect(t.result.rows).toEqual([
      ["id", "int"],
      ["name", "text"],
      ["born", "date"],
    ]);
  });
});
