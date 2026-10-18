import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  describePkColumns,
  describeColumnNames,
  isEditable,
  whereForRow,
  insertParams,
  updateParams,
  deleteParams,
  parseRowResult,
  rowCountOk,
  hasTransactions,
  txBeginIfSupported,
  txCommitIfOpen,
  txRollbackIfOpen,
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
      schema: "shop",
      values: { id: "3", name: "carol" },
    });
  });

  it("sends a database-only target as the schema row.* reads, a schema as itself", () => {
    // row.* reads only `schema`: a MySQL `shop.users` must not land on the
    // session's current database instead.
    expect(deleteParams("c1", target, { id: "1" })).toMatchObject({ db: "shop", schema: "shop" });
    expect(
      deleteParams("c1", { table: "t", db: "app", schema: "public" }, { id: "1" }),
    ).toMatchObject({ db: "app", schema: "public" });
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

  it("carries setTypes when given (so numeric columns are emitted unquoted)", () => {
    expect(
      updateParams("c1", { table: "t" }, { flag: "0" }, { id: "1" }, false, { flag: "int" }),
    ).toEqual({
      connId: "c1",
      table: "t",
      set: { flag: "0" },
      where: { id: "1" },
      setTypes: { flag: "int" },
    });
    expect(
      insertParams("c1", { table: "t" }, { flag: "1" }, false, { flag: "int" }),
    ).toEqual({
      connId: "c1",
      table: "t",
      values: { flag: "1" },
      setTypes: { flag: "int" },
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

// The iPhone commits a row edit only if it touched that one row (#577).
describe("rowCountOk", () => {
  it("takes exactly one row", () => {
    expect(rowCountOk("postgres", "update", 1)).toBe(true);
    expect(rowCountOk("sqlite", "delete", 1)).toBe(true);
  });

  it("refuses none or several", () => {
    expect(rowCountOk("postgres", "update", 0)).toBe(false);
    expect(rowCountOk("sqlite", "delete", 0)).toBe(false);
    expect(rowCountOk("informix", "update", 2)).toBe(false);
    expect(rowCountOk("mysql", "update", 2)).toBe(false);
  });

  it("lets MySQL's unchanged UPDATE through, not its missing DELETE", () => {
    expect(rowCountOk("mysql", "update", 0)).toBe(true);
    expect(rowCountOk("mariadb", "update", 0)).toBe(true);
    expect(rowCountOk("mysql", "delete", 0)).toBe(false);
  });

  it("cannot check a driver that reports no count", () => {
    expect(rowCountOk("mongodb", "update", undefined)).toBe(true);
  });
});

describe("rowCountOk for MongoDB", () => {
  it("wants exactly one document, as for SQL: matched, not changed", () => {
    expect(rowCountOk("mongodb", "update", 1)).toBe(true);
    expect(rowCountOk("mongodb", "delete", 1)).toBe(true);
    expect(rowCountOk("mongodb", "update", 0)).toBe(false);
    expect(rowCountOk("mongodb", "delete", 0)).toBe(false);
    expect(rowCountOk("mongodb", "update", 2)).toBe(false);
  });
});

describe("edit sessions on an engine without transactions", () => {
  const sent: string[] = [];
  let unsupported: Set<string>;

  beforeEach(() => {
    sent.length = 0;
    unsupported = new Set();
    (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number; method: string; params: { connId: string } };
      sent.push(`${req.method}:${req.params.connId}`);
      if (req.method === "tx.begin" && unsupported.has(req.params.connId)) {
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32001, message: "this engine does not support transactions" },
        };
      }
      return { jsonrpc: "2.0", id: req.id, result: {} };
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).quaeroRpc;
  });

  it("a transactional engine begins, commits and rolls back for real", async () => {
    expect(await txBeginIfSupported("c-sql")).toBe(true);
    expect(hasTransactions("c-sql")).toBe(true);
    await txCommitIfOpen("c-sql");
    await txRollbackIfOpen("c-sql");
    expect(sent).toEqual(["tx.begin:c-sql", "tx.commit:c-sql", "tx.rollback:c-sql"]);
  });

  it("an UNSUPPORTED tx.begin turns the session transaction-less: no commit or rollback is sent", async () => {
    unsupported.add("c-mongo");
    expect(await txBeginIfSupported("c-mongo")).toBe(false);
    expect(hasTransactions("c-mongo")).toBe(false);
    await txCommitIfOpen("c-mongo");
    await txRollbackIfOpen("c-mongo");
    expect(sent).toEqual(["tx.begin:c-mongo"]);
  });

  it("is per connection, and re-evaluated at each begin", async () => {
    unsupported.add("c-a");
    await txBeginIfSupported("c-a");
    await txBeginIfSupported("c-b");
    expect(hasTransactions("c-a")).toBe(false);
    expect(hasTransactions("c-b")).toBe(true);
    // the engine gains transactions (a replica set later): the next begin notices
    unsupported.delete("c-a");
    expect(await txBeginIfSupported("c-a")).toBe(true);
    expect(hasTransactions("c-a")).toBe(true);
  });

  it("any other tx.begin error keeps the session transactional (the failure surfaces at commit)", async () => {
    (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number };
      return { jsonrpc: "2.0", id: req.id, error: { code: -32003, message: "boom" } };
    };
    expect(await txBeginIfSupported("c-err")).toBe(true);
    expect(hasTransactions("c-err")).toBe(true);
  });
});
