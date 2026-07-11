import { describe, it, expect } from "vitest";
import {
  nextCellId,
  newCell,
  newNotebook,
  insertCellAfter,
  removeCell,
  updateCellSource,
  setCellKind,
  moveCell,
  applyParams,
  serializeNotebooks,
  parseNotebooks,
  coerceNotebook,
  nextNotebookId,
  upsertNotebook,
  removeNotebook,
  type Cell,
} from "../../src/utils/notebook";

const cells = (...ids: string[]): Cell[] =>
  ids.map((id) => ({ id, kind: "sql", source: "" }));

describe("cell ids + CRUD", () => {
  it("nextCellId is one past the max numeric suffix", () => {
    expect(nextCellId([])).toBe("cell-1");
    expect(nextCellId(cells("cell-1", "cell-4", "cell-2"))).toBe("cell-5");
  });

  it("newNotebook starts with one empty SQL cell", () => {
    const nb = newNotebook("nb-1", "N");
    expect(nb.cells).toEqual([{ id: "cell-1", kind: "sql", source: "" }]);
    expect(nb.params).toEqual([]);
  });

  it("inserts a cell after a given id (and at the end when unknown)", () => {
    const c = newCell(cells("cell-1", "cell-2"), "markdown");
    expect(c.id).toBe("cell-3");
    const list = insertCellAfter(cells("cell-1", "cell-2"), "cell-1", c);
    expect(list.map((x) => x.id)).toEqual(["cell-1", "cell-3", "cell-2"]);
    const atEnd = insertCellAfter(cells("cell-1"), "nope", c);
    expect(atEnd.map((x) => x.id)).toEqual(["cell-1", "cell-3"]);
  });

  it("removeCell keeps at least one cell", () => {
    expect(removeCell(cells("cell-1", "cell-2"), "cell-1").map((c) => c.id)).toEqual(["cell-2"]);
    expect(removeCell(cells("cell-1"), "cell-1").map((c) => c.id)).toEqual(["cell-1"]);
  });

  it("updates source and switches kind by id", () => {
    expect(updateCellSource(cells("cell-1"), "cell-1", "SELECT 1")[0].source).toBe("SELECT 1");
    expect(setCellKind(cells("cell-1"), "cell-1", "markdown")[0].kind).toBe("markdown");
  });

  it("moves a cell up/down and no-ops at the ends", () => {
    const l = cells("cell-1", "cell-2", "cell-3");
    expect(moveCell(l, "cell-2", -1).map((c) => c.id)).toEqual(["cell-2", "cell-1", "cell-3"]);
    expect(moveCell(l, "cell-3", 1).map((c) => c.id)).toEqual(["cell-1", "cell-2", "cell-3"]);
    expect(moveCell(l, "cell-1", -1).map((c) => c.id)).toEqual(["cell-1", "cell-2", "cell-3"]);
  });
});

describe("applyParams", () => {
  it("substitutes :name tokens with their values", () => {
    const out = applyParams("WHERE d >= :desde AND d <= :hasta", [
      { name: "desde", value: "'2024-01-01'" },
      { name: "hasta", value: "'2024-12-31'" },
    ]);
    expect(out).toBe("WHERE d >= '2024-01-01' AND d <= '2024-12-31'");
  });

  it("leaves an unknown :name untouched", () => {
    expect(applyParams("x = :foo", [])).toBe("x = :foo");
    expect(applyParams("x = :foo", [{ name: "bar", value: "1" }])).toBe("x = :foo");
  });

  it("substitutes a token at the start of the string", () => {
    expect(applyParams(":x", [{ name: "x", value: "42" }])).toBe("42");
  });

  it("does not treat a PostgreSQL :: cast as a parameter", () => {
    expect(applyParams("val::int", [{ name: "int", value: "BAD" }])).toBe("val::int");
  });
});

describe("serialize / parse", () => {
  it("round-trips notebooks", () => {
    const nb = newNotebook("nb-1", "Ventas");
    nb.params = [{ name: "y", value: "2024" }];
    const parsed = parseNotebooks(serializeNotebooks([nb]));
    expect(parsed).toEqual([nb]);
  });

  it("drops malformed items and bad cells; guarantees one cell", () => {
    expect(parseNotebooks("not json")).toEqual([]);
    expect(parseNotebooks(JSON.stringify([{ id: "nb-1" }]))).toEqual([]); // no name/cells
    const coerced = coerceNotebook({ id: "nb-2", name: "N", cells: [{ bad: 1 }] });
    expect(coerced?.cells).toEqual([{ id: "cell-1", kind: "sql", source: "" }]);
  });
});

describe("notebook list helpers", () => {
  it("nextNotebookId is unique within the list", () => {
    expect(nextNotebookId([])).toBe("nb-1");
    expect(nextNotebookId([newNotebook("nb-3", "a"), newNotebook("nb-1", "b")])).toBe("nb-4");
  });

  it("upsert replaces in place; remove drops by id", () => {
    const a = newNotebook("nb-1", "A");
    const b = newNotebook("nb-2", "B");
    const replaced = upsertNotebook([a, b], { ...a, name: "A2" });
    expect(replaced.map((n) => n.name)).toEqual(["A2", "B"]);
    expect(removeNotebook([a, b], "nb-1").map((n) => n.id)).toEqual(["nb-2"]);
  });
});
