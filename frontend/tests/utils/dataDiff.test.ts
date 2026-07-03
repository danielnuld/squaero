import { describe, it, expect } from "vitest";
import {
  diffData,
  dataDiffEmpty,
  dataDiffCount,
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
    expect(diffToPlan(diff)).toEqual([
      { kind: "insert", values: { id: "3", name: "carol" } },
      { kind: "update", set: { name: "r" }, where: { id: "2" } },
      { kind: "delete", where: { id: "4" } },
    ]);
  });
});
