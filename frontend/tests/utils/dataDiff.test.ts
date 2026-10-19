import { describe, it, expect } from "vitest";
import {
  diffData,
  dataDiffEmpty,
  dataDiffCount,
  dataDiffCounts,
  diffToPlan,
  pickOps,
  sameValue,
  DEFAULT_SYNC_OPS,
} from "../../src/utils/dataDiff";
import type { ResultSet } from "../../src/utils/query";

function rs(rows: (string | null)[][]): ResultSet {
  return {
    columns: [
      { name: "id", type: "int" },
      { name: "name", type: "text" },
    ],
    rows,
    truncated: false,
    rowsAffected: 0,
  };
}

describe("diffData", () => {
  const source = rs([
    ["1", "alice"], // unchanged
    ["2", "roberto"], // changed (was bob)
    ["3", "carol"], // new
  ]);
  const target = rs([
    ["1", "alice"],
    ["2", "bob"],
    ["4", "dave"], // only in target
  ]);

  it("keys by PK and classifies insert / update / delete", () => {
    const d = diffData(source, target, ["id"]);
    expect(d.inserts).toEqual([{ id: "3", name: "carol" }]);
    expect(d.updates).toEqual([{ set: { name: "roberto" }, where: { id: "2" } }]);
    expect(d.deletes).toEqual([{ where: { id: "4" } }]);
  });

  it("only sets the columns that actually differ", () => {
    const s = rs([["1", "x"]]);
    const t = rs([["1", "y"]]);
    expect(diffData(s, t, ["id"]).updates[0].set).toEqual({ name: "x" });
  });

  it("treats a NULL key value distinctly and matches identical rows", () => {
    const s = rs([[null, "a"]]);
    const t = rs([[null, "a"]]);
    expect(dataDiffEmpty(diffData(s, t, ["id"]))).toBe(true);
  });

  it("reports empty when the tables are identical", () => {
    expect(dataDiffEmpty(diffData(source, source, ["id"]))).toBe(true);
  });

  it("counts total operations", () => {
    expect(dataDiffCount(diffData(source, target, ["id"]))).toBe(3);
  });
});

describe("diffToPlan", () => {
  it("orders inserts, then updates, then deletes", () => {
    const diff = {
      inserts: [{ id: "3", name: "carol" }],
      updates: [{ set: { name: "r" }, where: { id: "2" } }],
      deletes: [{ where: { id: "4" } }],
    };
    expect(diffToPlan(diff).map((p) => p.kind)).toEqual(["insert", "update", "delete"]);
  });

  it("types the written columns so the driver emits typed literals (#761)", () => {
    const diff = {
      inserts: [{ id: "3", saldo: "10", activo: "1", alta: "2024-01-02", nota: null }],
      updates: [{ set: { saldo: "980.5" }, where: { id: "2" } }],
      deletes: [{ where: { id: "4" } }],
    };
    const types = { id: "int", saldo: "decimal", activo: "bool", alta: "date", nota: "text" };
    expect(diffToPlan(diff, types)).toEqual([
      { kind: "insert", values: diff.inserts[0], setTypes: types },
      { kind: "update", set: { saldo: "980.5" }, where: { id: "2" }, setTypes: { saldo: "decimal" } },
      { kind: "delete", where: { id: "4" } },
    ]);
  });
});

describe("compared range (#761)", () => {
  const page = (rows: (string | null)[][], truncated: boolean): ResultSet => ({
    ...rs(rows),
    truncated,
  });

  it("refuses to diff a partial read on either side", () => {
    const whole = page([["1", "a"]], false);
    const partial = page([["1", "a"]], true);
    expect(() => diffData(partial, whole, ["id"])).toThrow();
    expect(() => diffData(whole, partial, ["id"])).toThrow();
  });

  it("deletes only target keys that were read and absent from the source", () => {
    const s = rs([["1", "a"], ["2", "b"]]);
    const t = rs([["2", "b"], ["5", "e"]]);
    const d = diffData(s, t, ["id"]);
    expect(d.deletes).toEqual([{ where: { id: "5" } }]);
    expect(dataDiffCounts(d)).toEqual({ inserts: 1, updates: 0, deletes: 1 });
  });
});

describe("sameValue (type-aware equality)", () => {
  it("compares numbers by value, digit by digit", () => {
    expect(sameValue("980.50", "980.5", "float")).toBe(true);
    expect(sameValue("0980.500", "+980.5", "float")).toBe(true);
    expect(sameValue("-0.0", "0", "float")).toBe(true);
    expect(sameValue("10", "10.00", "int")).toBe(true);
    expect(sameValue("1e3", "1000", "float")).toBe(true);
    expect(sameValue("980.51", "980.5", "float")).toBe(false);
    // Beyond double precision, still told apart.
    expect(sameValue("12345678901234567890.1", "12345678901234567890.2", "float")).toBe(false);
  });

  it("compares text as text, and NULL equals only NULL", () => {
    expect(sameValue("980.50", "980.5", "text")).toBe(false);
    expect(sameValue(null, null, "float")).toBe(true);
    expect(sameValue(null, "0", "float")).toBe(false);
    expect(sameValue("", "0", "float")).toBe(false);
    expect(sameValue("abc", "abc ", "float")).toBe(false);
  });

  it("diffData emits no UPDATE for the same number written differently", () => {
    const cols = [
      { name: "id", type: "int" },
      { name: "saldo", type: "float" },
    ];
    const a = { columns: cols, rows: [["1", "980.50"]], truncated: false, rowsAffected: 0 };
    const b = { columns: cols, rows: [["1", "980.5"]], truncated: false, rowsAffected: 0 };
    expect(diffData(a, b, ["id"]).updates).toEqual([]);
  });
});

describe("pickOps", () => {
  const d = {
    inserts: [{ id: "3" }],
    updates: [{ set: { name: "x" }, where: { id: "2" } }],
    deletes: [{ where: { id: "4" } }],
  };

  it("leaves DELETE out by default", () => {
    expect(DEFAULT_SYNC_OPS).toEqual({ insert: true, update: true, delete: false });
    expect(dataDiffCounts(pickOps(d, DEFAULT_SYNC_OPS))).toEqual({ inserts: 1, updates: 1, deletes: 0 });
  });

  it("keeps only the ticked kinds", () => {
    expect(dataDiffCounts(pickOps(d, { insert: false, update: false, delete: true }))).toEqual({
      inserts: 0,
      updates: 0,
      deletes: 1,
    });
  });
});
