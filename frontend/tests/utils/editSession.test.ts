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
      { kind: "update", set: { name: "robert" }, where: { id: "2" }, setTypes: { name: "text" } },
    ]);
  });

  it("orders updates, then deletes, then inserts", () => {
    let s = setCell(emptyPending(), 0, "name", "AL");
    s = toggleDelete(s, 2);
    s = addInsert(s);
    s = setInsertCell(s, 0, "id", "4");
    s = setInsertCell(s, 0, "name", "dave");
    expect(buildPlan(source, cols, rows, s)).toEqual([
      { kind: "update", set: { name: "AL" }, where: { id: "1" }, setTypes: { name: "text" } },
      { kind: "delete", where: { id: "3" } },
      { kind: "insert", values: { id: "4", name: "dave" }, setTypes: { id: "int", name: "text" } },
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

// A SQL NULL is not an empty string, and the grid can now say so (issue #398).
// The distinction has to survive the whole chain: the pending set keeps the two
// apart, they both count as a change, and the plan carries the null through to
// row.update / row.insert — where the drivers emit the bare NULL keyword for it
// and a quoted '' for the empty string.
describe("NULL as a value", () => {
  it("keeps a null cell edit apart from an empty string", () => {
    const s = setCell(setCell(emptyPending(), 0, "name", null), 1, "name", "");
    expect(s.edits[0].name).toBeNull();
    expect(s.edits[1].name).toBe("");
  });

  it("counts a cell set to null as a pending change", () => {
    const s = setCell(emptyPending(), 0, "name", null);
    expect(hasChanges(s)).toBe(true);
    expect(changeCount(s)).toBe(1);
  });

  it("overwrites a null back to a value, and a value back to null", () => {
    let s = setCell(emptyPending(), 0, "name", null);
    s = setCell(s, 0, "name", "alice");
    expect(s.edits[0].name).toBe("alice");
    s = setCell(s, 0, "name", null);
    expect(s.edits[0].name).toBeNull();
  });

  it("carries the null into the update's set, not an empty string", () => {
    const s = setCell(emptyPending(), 1, "name", null);
    expect(buildPlan(source, cols, rows, s)).toEqual([
      { kind: "update", set: { name: null }, where: { id: "2" }, setTypes: { name: "text" } },
    ]);
  });

  it("carries the null into an inserted row's values", () => {
    let s = setInsertCell(addInsert(emptyPending()), 0, "id", "4");
    s = setInsertCell(s, 0, "name", null);
    expect(buildPlan(source, cols, rows, s)).toEqual([
      { kind: "insert", values: { id: "4", name: null }, setTypes: { id: "int", name: "text" } },
    ]);
  });

  it("an insert whose only value is null is still an insert, not an empty row", () => {
    const s = setInsertCell(addInsert(emptyPending()), 0, "name", null);
    expect(buildPlan(source, cols, rows, s)).toEqual([
      { kind: "insert", values: { name: null }, setTypes: { name: "text" } },
    ]);
  });
});
