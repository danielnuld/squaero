import { describe, it, expect } from "vitest";
import { columnKeys, structColumns, structIndexes, triggersOn } from "../../src/utils/structure";
import type { ResultSet } from "../../src/utils/query";

const rs = (cols: string[], rows: (string | null)[][]): ResultSet => ({
  columns: cols.map((name) => ({ name, type: "text" })),
  rows,
  truncated: false,
  rowsAffected: 0,
});

describe("structColumns", () => {
  it("reads the neutral describe shape", () => {
    const cols = structColumns(
      rs(["name", "type", "notnull", "dflt_value", "pk"], [
        ["id", "INTEGER", "1", null, "1"],
        ["email", "TEXT", "0", "'x'", "0"],
      ]),
    );
    expect(cols).toEqual([
      { name: "id", type: "INTEGER", nullable: false, defaultValue: "", pk: true },
      { name: "email", type: "TEXT", nullable: true, defaultValue: "'x'", pk: false },
    ]);
  });

  it("counts SQLite's numbered key columns as key", () => {
    const cols = structColumns(rs(["name", "pk"], [["a", "2"], ["b", "0"]]));
    expect(cols!.map((c) => c.pk)).toEqual([true, false]);
  });

  it("returns null for a result that is not the neutral shape", () => {
    expect(structColumns(rs(["Field", "Type"], [["id", "int"]]))).toBeNull();
  });
});

describe("structIndexes", () => {
  it("reads MySQL/SQLite columns and the Sí/No flag", () => {
    expect(structIndexes(rs(["name", "columnas", "unico"], [["ux", "a, b", "Sí"], ["ix", "c", "No"]]))).toEqual([
      { name: "ux", columns: ["a", "b"], unique: true },
      { name: "ix", columns: ["c"], unique: false },
    ]);
  });

  it("reads PostgreSQL's definition", () => {
    const [ix] = structIndexes(
      rs(["name", "definicion"], [["ux", 'CREATE UNIQUE INDEX ux ON public.t USING btree (email, "Ciudad")']]),
    );
    expect(ix).toEqual({ name: "ux", columns: ["email", "Ciudad"], unique: true });
  });

  it("leaves Informix's columns unknown", () => {
    expect(structIndexes(rs(["name", "unico"], [["i1", "No"]]))).toEqual([
      { name: "i1", columns: null, unique: false },
    ]);
  });

  it("reads MongoDB's key document; an absent unique means not unique", () => {
    expect(structIndexes(rs(["name", "key", "unique"], [["a_1", '{"a": 1}', null]]))).toEqual([
      { name: "a_1", columns: ["a"], unique: false },
    ]);
  });

  it("returns nothing without a name column", () => {
    expect(structIndexes(rs(["x"], [["1"]]))).toEqual([]);
  });
});

describe("columnKeys", () => {
  const fk = { fromTable: "pedidos", toTable: "clientes", constraint: "fk1", columns: [{ from: "cliente_id", to: "id" }] };

  it("says primary key once, not also as its unique index", () => {
    const notes = columnKeys("id", ["id"], [{ name: "PRIMARY", columns: ["id"], unique: true }], []);
    expect(notes).toEqual([{ kind: "pk" }]);
  });

  it("names unique and plain indexes and the referenced column", () => {
    const notes = columnKeys(
      "cliente_id",
      ["id"],
      [
        { name: "ix_c", columns: ["cliente_id"], unique: false },
        { name: "ux", columns: ["cliente_id", "fecha"], unique: true },
      ],
      [fk],
    );
    expect(notes).toEqual([
      { kind: "index", name: "ix_c" },
      { kind: "unique", name: "ux" },
      { kind: "fk", table: "clientes", column: "id" },
    ]);
  });

  it("does not attribute an index whose columns are unknown", () => {
    expect(columnKeys("a", [], [{ name: "i", columns: null, unique: true }], [])).toEqual([]);
  });
});

describe("triggersOn", () => {
  it("keeps the table's triggers with their timing and event", () => {
    const list = rs(["TRIGGER_NAME", "ACTION_TIMING", "EVENT_MANIPULATION", "EVENT_OBJECT_TABLE"], [
      ["t1", "AFTER", "INSERT", "Pedidos"],
      ["t2", "BEFORE", "UPDATE", "otra"],
    ]);
    expect(triggersOn("pedidos", list, { nameCol: "TRIGGER_NAME", tableCol: "EVENT_OBJECT_TABLE" })).toEqual([
      { name: "t1", when: "AFTER INSERT" },
    ]);
  });

  it("has no timing when the listing does not carry it", () => {
    const list = rs(["name", "table"], [["t", "x"]]);
    expect(triggersOn("x", list, { nameCol: "name", tableCol: "table" })).toEqual([{ name: "t", when: null }]);
  });

  it("is null when the listing has no owning table (Informix)", () => {
    expect(triggersOn("x", rs(["name"], [["t"]]), { nameCol: "name", tableCol: null })).toBeNull();
  });
});
