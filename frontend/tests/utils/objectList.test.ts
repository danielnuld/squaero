import { describe, it, expect } from "vitest";
import {
  objectListFor,
  formatBytes,
  listedObjects,
  listedTriggers,
  filterObjects,
  objectCounts,
} from "../../src/utils/objectList";

describe("objectListFor", () => {
  it("MySQL: information_schema.TABLES scoped to the db, full metadata", () => {
    const r = objectListFor("mysql", "ventas");
    expect(r.supported).toBe(true);
    expect(r.sql).toContain("information_schema.TABLES");
    expect(r.sql).toContain("TABLE_SCHEMA = 'ventas'");
    expect(r.columns.map((c) => c.key)).toEqual(["nombre", "tipo", "filas", "columnas", "indices", "tamano", "comentario"]);
    // Column and index counts per table; a view has no indexes.
    expect(r.sql).toContain("information_schema.COLUMNS c");
    expect(r.sql).toContain("CASE WHEN TABLE_TYPE = 'VIEW' THEN NULL");
  });

  it("escapes the db name against injection", () => {
    const r = objectListFor("mysql", "a' OR '1'='1");
    expect(r.sql).toContain("'a'' OR ''1''=''1'");
  });

  it("Informix: systables, row estimate only (no size/comment column)", () => {
    const r = objectListFor("informix", "ignored");
    expect(r.supported).toBe(true);
    expect(r.sql).toContain("FROM systables");
    expect(r.sql).toContain("tabid > 99");
    expect(r.columns.map((c) => c.key)).toEqual(["nombre", "tipo", "filas", "columnas", "indices"]);
    expect(r.sql).toContain("ncols AS columnas");
    // The type CASE is CHAR(5) there ('table'), so 'view' comes back padded
    // unless it is trimmed in the query itself (issue #315).
    expect(r.sql).toContain("TRIM(CASE WHEN tabtype = 'V' THEN 'view' ELSE 'table' END)");
  });

  it("SQLite: sqlite_master, name+type, skips internal objects", () => {
    const r = objectListFor("sqlite", "main");
    expect(r.sql).toContain("FROM sqlite_master");
    expect(r.sql).toContain("name NOT LIKE 'sqlite_%'");
    expect(r.columns.map((c) => c.key)).toEqual(["nombre", "tipo", "columnas", "indices"]);
    expect(r.sql).toContain("pragma_table_info(m.name)");
    expect(r.sql).toContain("CASE WHEN m.type = 'view' THEN NULL");
  });

  it("PostgreSQL: pg_class metadata (SQL ready even though driver ships later)", () => {
    const r = objectListFor("postgres", "public");
    expect(r.supported).toBe(true);
    expect(r.sql).toContain("pg_class");
    expect(r.sql).toContain("n.nspname = 'public'");
    expect(r.sql).toContain("NOT a.attisdropped");
    expect(r.columns.map((c) => c.key)).toEqual(["nombre", "tipo", "filas", "columnas", "indices", "tamano", "comentario"]);
  });

  it("MongoDB: lists the collections and views the server reports", () => {
    const r = objectListFor("mongodb", "x");
    expect(r.supported).toBe(true);
    expect(r.sql).toBe("db.getCollectionInfos()");
    expect(r.reason).toBeNull();
    // Its own result columns, not the SQL engines' nombre / tipo aliases.
    expect(r.nameKey).toBe("name");
    expect(r.typeKey).toBe("type");
    expect(r.columns.map((c) => c.key)).toEqual(["name", "type"]);
    // Only what the server gives: no invented row count or size.
    expect(r.columns.map((c) => c.key)).not.toContain("filas");
  });

  it("unknown engine: unsupported", () => {
    expect(objectListFor("oracle", "x").supported).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats byte magnitudes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(42 * 1024 * 1024)).toBe("42 MB");
    expect(formatBytes("18700000")).toBe("18 MB");
  });
  it("passes through empty/invalid honestly", () => {
    expect(formatBytes(null)).toBe("");
    expect(formatBytes("")).toBe("");
  });
});

describe("listed objects", () => {
  const cols = [{ name: "nombre" }, { name: "tipo" }];
  const objs = listedObjects(cols, [["clientes", "table"], ["v ", "view "], ["Pedidos", "table"]], {});
  const trgs = listedTriggers(
    [{ name: "TRIGGER_NAME" }, { name: "EVENT_OBJECT_TABLE" }],
    [["trg_total", "pedidos"]],
    { nameCol: "TRIGGER_NAME", tableCol: "EVENT_OBJECT_TABLE" },
  );

  it("reads names and kinds, trimming padded values (#315)", () => {
    expect(objs.map((o) => [o.name, o.kind])).toEqual([
      ["clientes", "table"],
      ["v", "view"],
      ["Pedidos", "table"],
    ]);
  });

  it("lists anything without a type column as a table, nothing without a name", () => {
    expect(listedObjects([{ name: "nombre" }], [["x"]], {})[0].kind).toBe("table");
    expect(listedObjects([{ name: "x" }], [["x"]], {})).toEqual([]);
  });

  it("reads MongoDB's own name/type columns", () => {
    const m = listedObjects([{ name: "name" }, { name: "type" }], [["o", "collection"], ["w", "view"]], {
      nameKey: "name",
      typeKey: "type",
    });
    expect(m.map((o) => o.kind)).toEqual(["table", "view"]);
  });

  it("lists triggers with their table", () => {
    expect(trgs).toEqual([{ name: "trg_total", kind: "trigger", row: [], on: "pedidos" }]);
    expect(listedTriggers([{ name: "x" }], [["a"]], { nameCol: "name", tableCol: null })).toEqual([]);
  });

  it("filters by kind and by name, ignoring case", () => {
    const list = [...objs, ...trgs];
    expect(filterObjects(list, "trigger", "").map((o) => o.name)).toEqual(["trg_total"]);
    expect(filterObjects(list, "all", "PED").map((o) => o.name)).toEqual(["Pedidos"]);
    expect(filterObjects(list, "view", "  ").map((o) => o.name)).toEqual(["v"]);
  });

  it("counts each kind", () => {
    expect(objectCounts([...objs, ...trgs])).toEqual({ all: 4, table: 2, view: 1, trigger: 1 });
    expect(objectCounts([])).toEqual({ all: 0, table: 0, view: 0, trigger: 0 });
  });
});
