import { describe, it, expect } from "vitest";
import {
  diffData,
  dataDiffEmpty,
  dataDiffCount,
  dataDiffCounts,
  diffToPlan,
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
