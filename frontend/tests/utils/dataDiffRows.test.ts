import { describe, it, expect } from "vitest";
import { diffData } from "../../src/utils/dataDiff";
import { diffRows, equalCount } from "../../src/utils/dataDiffRows";
import type { ResultSet } from "../../src/utils/query";

const rs = (rows: (string | null)[][]): ResultSet => ({
  columns: [
    { name: "id", type: "int" },
    { name: "nombre", type: "text" },
    { name: "saldo", type: "float" },
  ],
  rows,
  truncated: false,
  rowsAffected: 0,
});

describe("diffRows", () => {
  const source = rs([
    ["1", "Ana", "10"],
    ["2", "Eva", "980.50"],
    ["12", "Andrés", null],
  ]);
  const target = rs([
    ["1", "Ana", "10"],
    ["2", "Eva", "900.00"],
    ["7", "Luis", "5"],
  ]);
  const diff = diffData(source, target, ["id"]);
  const cols = ["id", "nombre", "saldo"];

  it("lists an insert as a new row with its values", () => {
    expect(diffRows(diff, target, ["id"], cols)[0]).toEqual({
      op: "INSERT",
      key: ["12"],
      column: null,
      from: null,
      to: "Andrés · NULL",
    });
  });

  it("lists an update per changed column, with the target's value now", () => {
    const rows = diffRows(diff, target, ["id"], cols).filter((r) => r.op === "UPDATE");
    expect(rows).toEqual([{ op: "UPDATE", key: ["2"], column: "saldo", from: "900.00", to: "980.50" }]);
  });

  it("lists a delete with the values it removes", () => {
    const rows = diffRows(diff, target, ["id"], cols).filter((r) => r.op === "DELETE");
    expect(rows).toEqual([{ op: "DELETE", key: ["7"], column: null, from: "Luis · 5", to: null }]);
  });

  it("keeps a composite key in pk order", () => {
    const a = { ...source, columns: [{ name: "a", type: "int" }, { name: "b", type: "int" }, { name: "v", type: "text" }] };
    const s = { ...a, rows: [["1", "2", "x"]] };
    const t = { ...a, rows: [["1", "2", "y"]] };
    expect(diffRows(diffData(s, t, ["b", "a"]), t, ["b", "a"], ["a", "b", "v"])[0].key).toEqual(["2", "1"]);
  });

  it("is empty when both sides match", () => {
    expect(diffRows(diffData(source, source, ["id"]), source, ["id"], cols)).toEqual([]);
  });
});

describe("equalCount", () => {
  it("counts the source rows left as they are", () => {
    const diff = { inserts: [{}], updates: [{ set: {}, where: {} }], deletes: [{ where: {} }, { where: {} }] };
    expect(equalCount(12, diff)).toBe(10);
    expect(equalCount(0, diff)).toBe(0);
  });
});
