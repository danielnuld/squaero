import { describe, it, expect } from "vitest";
import {
  buildRowFields,
  clampRowIndex,
  stepRowIndex,
  canStep,
} from "../../src/utils/rowDetail";
import type { ResultColumn } from "../../src/utils/query";

const columns: ResultColumn[] = [
  { name: "id", type: "int" },
  { name: "name", type: "text" },
  { name: "notes", type: "text" },
];

describe("buildRowFields", () => {
  it("maps each column to its value with no pending edits", () => {
    const fields = buildRowFields(columns, ["1", "alice", null]);
    expect(fields).toEqual([
      { name: "id", type: "int", original: "1", value: "1", edited: false },
      { name: "name", type: "text", original: "alice", value: "alice", edited: false },
      { name: "notes", type: "text", original: null, value: null, edited: false },
    ]);
  });

  it("overlays a pending edit and flags it as edited", () => {
    const fields = buildRowFields(columns, ["1", "alice", null], { name: "ALICE" });
    expect(fields[1]).toMatchObject({ value: "ALICE", edited: true });
    expect(fields[0].edited).toBe(false);
  });

  it("does not flag a pending edit equal to the original", () => {
    const fields = buildRowFields(columns, ["1", "alice", null], { name: "alice" });
    expect(fields[1]).toMatchObject({ value: "alice", edited: false });
  });

  it("treats setting a value on a NULL cell as an edit", () => {
    const fields = buildRowFields(columns, ["1", "alice", null], { notes: "" });
    expect(fields[2]).toMatchObject({ original: null, value: "", edited: true });
  });

  it("missing cells default to NULL", () => {
    const fields = buildRowFields(columns, ["1"]);
    expect(fields[1].original).toBeNull();
    expect(fields[2].original).toBeNull();
  });
});

describe("clampRowIndex / stepRowIndex / canStep", () => {
  it("clamps into range", () => {
    expect(clampRowIndex(-3, 5)).toBe(0);
    expect(clampRowIndex(9, 5)).toBe(4);
    expect(clampRowIndex(2, 5)).toBe(2);
  });

  it("clamps to 0 for an empty set", () => {
    expect(clampRowIndex(4, 0)).toBe(0);
  });

  it("steps and clamps at the ends", () => {
    expect(stepRowIndex(0, -1, 3)).toBe(0);
    expect(stepRowIndex(0, 1, 3)).toBe(1);
    expect(stepRowIndex(2, 1, 3)).toBe(2);
  });

  it("canStep reports whether a move stays in range", () => {
    expect(canStep(0, -1, 3)).toBe(false);
    expect(canStep(0, 1, 3)).toBe(true);
    expect(canStep(2, 1, 3)).toBe(false);
    expect(canStep(1, 1, 3)).toBe(true);
  });
});
