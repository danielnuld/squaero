import { describe, it, expect } from "vitest";
import { copyRows, rowsAsInserts, rowToTsv, rowToJson } from "../../src/utils/rowCopy";
import type { ResultColumn, ResultSet } from "../../src/utils/query";

const cols: ResultColumn[] = [
  { name: "id", type: "int" },
  { name: "name", type: "text" },
  { name: "note", type: "text" },
];

describe("rowToTsv", () => {
  it("joins cells with tabs, NULL as empty", () => {
    expect(rowToTsv(["1", "Ana", null])).toBe("1\tAna\t");
  });

  it("handles an all-null row", () => {
    expect(rowToTsv([null, null])).toBe("\t");
  });
});

describe("rowToJson", () => {
  it("keys cells by column name, NULL as JSON null", () => {
    expect(rowToJson(cols, ["1", "Ana", null])).toBe(
      '{"id":"1","name":"Ana","note":null}',
    );
  });

  it("ignores extra cells beyond the columns", () => {
    expect(rowToJson([{ name: "a", type: "text" }], ["x", "y"])).toBe('{"a":"x"}');
  });
});

// Copying rows keeps an exact copy beside the text (#517).
describe("copyRows", () => {
  const result: ResultSet = {
    columns: cols,
    rows: [
      ["1", "Ana", null],
      ["2", "Luis", "a\tb"],
      ["3", "", "x"],
    ],
    truncated: false,
    rowsAffected: 0,
  };
  const source = { connDefId: "c1", db: "ventas", table: "clientes" };

  it("keeps NULL, empty strings and tabs exactly, beside the lossy text", () => {
    const clip = copyRows(result, [0, 1], [], source);
    expect(clip.columns).toEqual(["id", "name", "note"]);
    expect(clip.rows).toEqual([
      ["1", "Ana", null],
      ["2", "Luis", "a\tb"],
    ]);
    expect(clip.text).toBe("1\tAna\t\n2\tLuis\ta\tb");
    expect(clip.source).toBe(source);
  });

  it("follows the grid's column order in both forms", () => {
    const clip = copyRows(result, [2], [2, 0, 1], null);
    expect(clip.columns).toEqual(["note", "id", "name"]);
    expect(clip.rows).toEqual([["x", "3", ""]]);
    expect(clip.text).toBe("x\t3\t");
  });

  it("copies rows in the order asked for", () => {
    const clip = copyRows(result, [2, 0], [], null);
    expect(clip.rows.map((r) => r[0])).toEqual(["3", "1"]);
  });

  it("skips row indices the result does not have", () => {
    const clip = copyRows(result, [1, 9], [], null);
    expect(clip.rows).toHaveLength(1);
    expect(clip.text).toBe("2\tLuis\ta\tb");
  });

  it("does not share arrays with the result", () => {
    const clip = copyRows(result, [0], [], null);
    clip.rows[0][1] = "changed";
    expect(result.rows[0][1]).toBe("Ana");
  });
});

describe("rowsAsInserts", () => {
  const result: ResultSet = {
    columns: cols,
    rows: [
      ["1", "Ana", null],
      ["2", "Luis", ""],
    ],
    truncated: false,
    rowsAffected: 0,
  };

  it("maps each row by column name, NULL kept apart from empty", () => {
    expect(rowsAsInserts(result, [1, 0])).toEqual([
      { id: "2", name: "Luis", note: "" },
      { id: "1", name: "Ana", note: null },
    ]);
  });

  it("skips row indices the result does not have", () => {
    expect(rowsAsInserts(result, [5])).toEqual([]);
  });
});
