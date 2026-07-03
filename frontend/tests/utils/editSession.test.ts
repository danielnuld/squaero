import { describe, it, expect } from "vitest";
import {
  emptyPending,
  setCell,
  toggleDelete,
  addInsert,
  setInsertCell,
  removeInsert,
  hasChanges,
  changeCount,
  buildPlan,
  type EditSource,
} from "../../src/utils/editSession";
import type { ResultColumn } from "../../src/utils/query";

const cols: ResultColumn[] = [
  { name: "id", type: "int" },
  { name: "name", type: "text" },
];
const rows: (string | null)[][] = [
  ["1", "alice"],
  ["2", "bob"],
  ["3", "carol"],
];
const source: EditSource = { table: "users", pk: ["id"] };

describe("pending change accumulation", () => {
  it("records cell edits immutably", () => {
    const s0 = emptyPending();
    const s1 = setCell(s0, 1, "name", "robert");
    expect(s0.edits).toEqual({}); // original untouched
    expect(s1.edits).toEqual({ 1: { name: "robert" } });
    const s2 = setCell(s1, 1, "name", "rob");
    expect(s2.edits[1].name).toBe("rob"); // overwrite same cell
  });

  it("toggles deletions on and off", () => {
    let s = toggleDelete(emptyPending(), 2);
    expect(s.deletes).toEqual([2]);
    s = toggleDelete(s, 2);
    expect(s.deletes).toEqual([]);
  });

  it("adds, edits and removes inserted rows", () => {
    let s = addInsert(emptyPending());
    s = setInsertCell(s, 0, "id", "9");
    s = setInsertCell(s, 0, "name", "dave");
    expect(s.inserts).toEqual([{ id: "9", name: "dave" }]);
    s = removeInsert(s, 0);
    expect(s.inserts).toEqual([]);
  });

  it("reports whether and how many changes are pending", () => {
    expect(hasChanges(emptyPending())).toBe(false);
    const s = setCell(emptyPending(), 0, "name", "x");
    expect(hasChanges(s)).toBe(true);
    expect(changeCount(s)).toBe(1);
  });

  it("does not double-count a row that is both edited and deleted", () => {
    let s = setCell(emptyPending(), 0, "name", "x");
    s = toggleDelete(s, 0);
    // one delete, the edit is superseded
    expect(changeCount(s)).toBe(1);
  });
});

describe("buildPlan", () => {
  it("emits updates keyed by the original primary key", () => {
    const s = setCell(emptyPending(), 1, "name", "robert");
    expect(buildPlan(source, cols, rows, s)).toEqual([
      { kind: "update", set: { name: "robert" }, where: { id: "2" } },
    ]);
  });

  it("orders updates, then deletes, then inserts", () => {
    let s = setCell(emptyPending(), 0, "name", "AL");
    s = toggleDelete(s, 2);
    s = addInsert(s);
    s = setInsertCell(s, 0, "id", "4");
    s = setInsertCell(s, 0, "name", "dave");
    expect(buildPlan(source, cols, rows, s)).toEqual([
      { kind: "update", set: { name: "AL" }, where: { id: "1" } },
      { kind: "delete", where: { id: "3" } },
      { kind: "insert", values: { id: "4", name: "dave" } },
    ]);
  });

  it("a row edited and then deleted yields only a delete", () => {
    let s = setCell(emptyPending(), 0, "name", "x");
    s = toggleDelete(s, 0);
    expect(buildPlan(source, cols, rows, s)).toEqual([
      { kind: "delete", where: { id: "1" } },
    ]);
  });

  it("drops an empty inserted row", () => {
    const s = addInsert(emptyPending());
    expect(buildPlan(source, cols, rows, s)).toEqual([]);
  });

  it("skips a row whose primary key is not projected by the SELECT", () => {
    const noKey: EditSource = { table: "t", pk: ["missing"] };
    const s = setCell(emptyPending(), 0, "name", "x");
    expect(buildPlan(noKey, cols, rows, s)).toEqual([]);
  });
});
