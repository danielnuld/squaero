import { describe, it, expect } from "vitest";
import {
  describePkColumns,
  describeColumnNames,
  isEditable,
  whereForRow,
  insertParams,
  updateParams,
  deleteParams,
  parseRowResult,
} from "../../src/utils/edit";
import type { ResultSet, ResultColumn } from "../../src/utils/query";
import type { JsonRpcResponse } from "../../src/utils/ipc";

/** A schema.describe-shaped result: columns name/type/notnull/dflt_value/pk. */
function describe_(rows: (string | null)[][]): ResultSet {
  return {
    columns: [
      { name: "name", type: "text" },
      { name: "type", type: "text" },
      { name: "notnull", type: "int" },
      { name: "dflt_value", type: "text" },
      { name: "pk", type: "int" },
    ],
    rows,
    truncated: false,
    rowsAffected: 0,
  };
}

describe("describePkColumns", () => {
  it("returns the columns whose pk cell is truthy", () => {
    const d = describe_([
      ["id", "int", "1", null, "1"],
      ["name", "text", "0", null, "0"],
    ]);
    expect(describePkColumns(d)).toEqual(["id"]);
  });

  it("supports a composite key in column order", () => {
    const d = describe_([
      ["a", "int", "1", null, "1"],
      ["b", "int", "1", null, "1"],
      ["c", "text", "0", null, "0"],
    ]);
    expect(describePkColumns(d)).toEqual(["a", "b"]);
  });

  it("returns [] when the describe result lacks a pk column", () => {
    const d: ResultSet = {
      columns: [{ name: "name", type: "text" }],
      rows: [["x"]],
      truncated: false,
      rowsAffected: 0,
    };
    expect(describePkColumns(d)).toEqual([]);
  });
});

describe("describeColumnNames", () => {
  it("returns the name column in order, dropping blanks", () => {
    const d = describe_([
      ["id", "int", "1", null, "1"],
      ["nombre", "text", "0", null, "0"],
      [null, "text", "0", null, "0"],
    ]);
    expect(describeColumnNames(d)).toEqual(["id", "nombre"]);
  });

  it("returns [] when there is no name column", () => {
    const d: ResultSet = {
      columns: [{ name: "type", type: "text" }],
      rows: [["int"]],
      truncated: false,
      rowsAffected: 0,
    };
    expect(describeColumnNames(d)).toEqual([]);
  });
});

describe("isEditable", () => {
  it("is true only when a primary key exists", () => {
    expect(isEditable(describe_([["id", "int", "1", null, "1"]]))).toBe(true);
    expect(isEditable(describe_([["v", "text", "0", null, "0"]]))).toBe(false);
  });
});

describe("whereForRow", () => {
  const cols: ResultColumn[] = [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
  ];

  it("maps each pk column to its value in the row", () => {
    expect(whereForRow(cols, ["42", "ana"], ["id"])).toEqual({ id: "42" });
  });

  it("carries a NULL pk value through", () => {
    expect(whereForRow(cols, [null, "ana"], ["id"])).toEqual({ id: null });
  });

  it("returns null when a pk column is not projected by the SELECT", () => {
    expect(whereForRow(cols, ["42", "ana"], ["missing"])).toBeNull();
  });

  it("returns null with an empty key", () => {
    expect(whereForRow(cols, ["42", "ana"], [])).toBeNull();
  });
});

describe("row.* param builders", () => {
  const target = { table: "users", db: "shop" };

  it("insert carries values and the qualifier, no preview by default", () => {
    expect(insertParams("c1", target, { id: "3", name: "carol" })).toEqual({
      connId: "c1",
      table: "users",
      db: "shop",
      values: { id: "3", name: "carol" },
    });
  });

  it("update carries set + where, and preview when asked", () => {
    expect(
      updateParams("c1", { table: "t" }, { name: "ana" }, { id: "1" }, true),
    ).toEqual({
      connId: "c1",
      table: "t",
      set: { name: "ana" },
      where: { id: "1" },
      preview: true,
    });
  });

  it("delete carries the where key", () => {
    expect(deleteParams("c1", { table: "t" }, { id: "9" })).toEqual({
      connId: "c1",
      table: "t",
      where: { id: "9" },
    });
  });
});

describe("parseRowResult", () => {
  it("reads sql and rowsAffected from an apply response", () => {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { sql: "UPDATE t SET a=1 WHERE id=2", rowsAffected: 1 },
    };
    expect(parseRowResult(res)).toEqual({
      sql: "UPDATE t SET a=1 WHERE id=2",
      rowsAffected: 1,
    });
  });

  it("omits rowsAffected on a preview response", () => {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { sql: "DELETE FROM t WHERE id=2" },
    };
    expect(parseRowResult(res)).toEqual({ sql: "DELETE FROM t WHERE id=2" });
  });

  it("throws QueryError on an error response", () => {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32001, message: "this engine does not support editing data" },
    };
    expect(() => parseRowResult(res)).toThrow(/editing/);
  });
});
