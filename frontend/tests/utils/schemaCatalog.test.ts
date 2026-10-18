import { describe, it, expect } from "vitest";
import {
  constraintCatalogSql,
  checkCatalogSql,
  indexCatalogSql,
  applyConstraints,
  applyChecks,
  applyIndexes,
  mysqlDefault,
  readSnapshot,
  NotATableListError,
  type SnapshotSource,
} from "../../src/utils/schemaCatalog";
import type { TableDef } from "../../src/utils/schemaDiff";
import type { ResultSet } from "../../src/utils/query";

const rs = (names: string[], rows: (string | null)[][]): ResultSet => ({
  columns: names.map((name) => ({ name, type: "text" })),
  rows,
  truncated: false,
  rowsAffected: 0,
});

const CONSTRAINT_COLS = ["table_name", "constraint_name", "kind", "column_name", "position", "ref_table", "ref_column"];
const INDEX_COLS = ["table_name", "index_name", "is_unique", "column_name", "position", "special"];

const tables = (...names: string[]) =>
  new Map<string, TableDef>(
    names.map((n) => [
      n.toLowerCase(),
      { name: n, columns: [], primaryKey: { columns: ["stale"] }, uniques: [], indexes: [], foreignKeys: [], checks: [] },
    ]),
  );

describe("catalog SQL", () => {
  const engines = ["postgres", "mysql", "mssql", "sqlite", "informix"];

  it("has a constraints and an indexes query for every SQL engine, none for MongoDB", () => {
    for (const e of engines) {
      expect(constraintCatalogSql(e)).toMatch(/AS table_name/);
      expect(indexCatalogSql(e)).toMatch(/AS index_name/);
    }
    expect(constraintCatalogSql("mongodb")).toBeNull();
    expect(indexCatalogSql("mongodb")).toBeNull();
  });

  it("reads CHECKs where a catalog has them, and says so where none does", () => {
    for (const e of ["postgres", "mysql", "mssql"]) expect(checkCatalogSql(e)).toMatch(/AS definition/);
    for (const e of ["sqlite", "informix", "mongodb"]) expect(checkCatalogSql(e)).toBeNull();
  });

  it("scopes to the container, escaping the literal", () => {
    expect(constraintCatalogSql("postgres", { schema: "o'k" })).toContain("n.nspname = 'o''k'");
    expect(constraintCatalogSql("postgres")).toContain("n.nspname = current_schema()");
    expect(indexCatalogSql("mysql", { db: "a\\b" })).toContain("TABLE_SCHEMA = 'a\\\\b'");
    expect(indexCatalogSql("mariadb")).toContain("TABLE_SCHEMA = DATABASE()");
    expect(checkCatalogSql("mssql", { db: "Sales", schema: "dbo" })).toContain("FROM [Sales].sys.check_constraints");
    expect(checkCatalogSql("mssql")).toContain("s.name = SCHEMA_NAME()");
    expect(constraintCatalogSql("sqlite", { db: "aux" })).toContain(`FROM "aux".sqlite_master m JOIN pragma_table_info(m.name, 'aux')`);
    expect(constraintCatalogSql("sqlite")).toContain(`"main".sqlite_master`);
  });

  it("covers the sixteen Informix key parts, qualified by database", () => {
    const sql = indexCatalogSql("informix", { db: "stores" })!;
    expect(sql.match(/UNION ALL/g)).toHaveLength(15);
    expect(sql).toContain("ABS(i.part16)");
    expect(sql).toContain("FROM stores:sysindexes i");
    expect(constraintCatalogSql("informix", { db: "bad name" })).not.toContain("bad name");
  });
});

describe("applyConstraints", () => {
  it("groups key columns by position and replaces the describe primary key", () => {
    const t = tables("orders", "items", "loose");
    applyConstraints(
      t,
      "postgres",
      rs(CONSTRAINT_COLS, [
        ["items", "items_pkey", "P", "line", "2", null, null],
        ["items", "items_pkey", "P", "order_id", "1", null, null],
        ["items", "items_order_fk", "F", "order_id", "1", "orders", "id"],
        ["items", "items_sku_uq", "U", "sku", "1", null, null],
        ["ghost", "x", "P", "a", "1", null, null],
      ]),
    );
    const items = t.get("items")!;
    expect(items.primaryKey).toEqual({ name: "items_pkey", columns: ["order_id", "line"] });
    expect(items.uniques).toEqual([{ name: "items_sku_uq", columns: ["sku"] }]);
    expect(items.foreignKeys).toEqual([
      { name: "items_order_fk", columns: ["order_id"], refTable: "orders", refColumns: ["id"] },
    ]);
    expect(t.get("loose")!.primaryKey).toBeNull();
  });

  it("drops names that are not real (MySQL PRIMARY, SQLite ids) and reads Informix R as a foreign key", () => {
    const my = tables("t");
    applyConstraints(my, "mysql", rs(CONSTRAINT_COLS, [["t", "PRIMARY", "P", "id", "1", null, null]]));
    expect(my.get("t")!.primaryKey).toEqual({ name: undefined, columns: ["id"] });

    const ifx = tables("t");
    applyConstraints(ifx, "informix", rs(CONSTRAINT_COLS, [["t", "r101_5", "R", "p", "1", "parent", "id"]]));
    expect(ifx.get("t")!.foreignKeys[0]).toMatchObject({ name: "r101_5", refTable: "parent" });
  });

  it("fills a SQLite reference to the parent's primary key", () => {
    const t = tables("parent", "child");
    applyConstraints(
      t,
      "sqlite",
      rs(CONSTRAINT_COLS, [
        ["child", "0", "F", "pid", "1", "parent", null],
        ["parent", null, "P", "id", "1", null, null],
        ["child", "sqlite_autoindex_child_1", "U", "code", "1", null, null],
      ]),
    );
    expect(t.get("child")!.foreignKeys).toEqual([
      { name: undefined, columns: ["pid"], refTable: "parent", refColumns: ["id"] },
    ]);
    expect(t.get("child")!.uniques).toEqual([{ name: undefined, columns: ["code"] }]);
  });
});

describe("applyChecks", () => {
  it("keeps the expression, stripping PostgreSQL's CHECK keyword", () => {
    const t = tables("t");
    applyChecks(
      t,
      rs(["table_name", "constraint_name", "definition"], [
        ["t", "t_qty_check", "CHECK ((qty > 0))"],
        ["T", "ck2", "([price]>(0))"],
        ["other", "x", "(1)"],
      ]),
    );
    expect(t.get("t")!.checks).toEqual([
      { name: "t_qty_check", expr: "((qty > 0))" },
      { name: "ck2", expr: "([price]>(0))" },
    ]);
  });
});

describe("applyIndexes", () => {
  it("groups columns by position and skips what cannot be compared", () => {
    const t = tables("t");
    const skipped = applyIndexes(
      t,
      rs(INDEX_COLS, [
        ["t", "ix_ab", "0", "b", "2", "0"],
        ["t", "ix_ab", "0", "a", "1", "0"],
        ["t", "ux_c", "1", "c", "1", "0"],
        ["t", "ix_expr", "0", null, "1", "0"],
        ["t", "ix_partial", "0", "a", "1", "1"],
      ]),
    );
    expect(t.get("t")!.indexes).toEqual([
      { name: "ix_ab", columns: ["a", "b"], unique: false },
      { name: "ux_c", columns: ["c"], unique: true },
    ]);
    expect(skipped).toEqual(["t.ix_expr", "t.ix_partial"]);
  });
});

describe("mysqlDefault", () => {
  it("quotes bare strings and keeps numbers, literals and functions", () => {
    expect(mysqlDefault(null)).toBeNull();
    expect(mysqlDefault("NULL")).toBeNull();
    expect(mysqlDefault("abc")).toBe("'abc'");
    expect(mysqlDefault("it's")).toBe("'it''s'");
    expect(mysqlDefault("")).toBe("''");
    expect(mysqlDefault("-1.5")).toBe("-1.5");
    expect(mysqlDefault("'x'")).toBe("'x'");
    expect(mysqlDefault("b'0'")).toBe("b'0'");
    expect(mysqlDefault("CURRENT_TIMESTAMP")).toBe("CURRENT_TIMESTAMP");
    expect(mysqlDefault("uuid()")).toBe("uuid()");
  });
});

describe("readSnapshot", () => {
  const tree = rs(["name", "type"], [
    ["users", "table"],
    ["v_users", "view"],
  ]);
  const describeRs = rs(["name", "type", "notnull", "dflt_value", "pk"], [
    ["id", "int", "1", null, "1"],
    ["name", "varchar(10)", "0", "anon", "0"],
  ]);

  const fake = (engine: string, over: Partial<SnapshotSource> = {}): SnapshotSource & { sql: string[] } => {
    const sql: string[] = [];
    return {
      sql,
      engine,
      container: {},
      tree: async () => tree,
      describe: async () => describeRs,
      ddl: async (v) => `CREATE VIEW ${v} AS SELECT * FROM users`,
      query: async (q) => {
        sql.push(q);
        if (q.includes("index_name")) return rs(INDEX_COLS, [["users", "ix_name", "0", "name", "1", "0"]]);
        if (q.includes("definition")) return rs(["table_name", "constraint_name", "definition"], []);
        return rs(CONSTRAINT_COLS, [["users", "PRIMARY", "P", "id", "1", null, null]]);
      },
      ...over,
    };
  };

  it("reads tables, keys, indexes and views; quotes MySQL defaults", async () => {
    const s = await readSnapshot(fake("mysql"));
    expect(s.missing).toEqual({});
    expect(s.tables).toHaveLength(1);
    expect(s.tables[0].columns[1].dflt).toBe("'anon'");
    expect(s.tables[0].primaryKey).toEqual({ name: undefined, columns: ["id"] });
    expect(s.tables[0].indexes).toEqual([{ name: "ix_name", columns: ["name"], unique: false }]);
    expect(s.views).toEqual([{ name: "v_users", ddl: "CREATE VIEW v_users AS SELECT * FROM users" }]);
  });

  it("marks a failing catalog query as missing with its error, keeping the rest", async () => {
    const src = fake("mysql");
    const inner = src.query;
    src.query = async (q) => {
      if (q.includes("CHECK_CONSTRAINTS")) throw new Error("Unknown table 'CHECK_CONSTRAINTS'");
      return inner(q);
    };
    const s = await readSnapshot(src);
    expect(s.missing).toEqual({ checks: "Unknown table 'CHECK_CONSTRAINTS'" });
    expect(s.tables[0].indexes).toHaveLength(1);
  });

  it("marks what an engine has no catalog for: SQLite checks, Informix checks and defaults", async () => {
    expect((await readSnapshot(fake("sqlite"))).missing).toEqual({ checks: "" });
    expect((await readSnapshot(fake("informix"))).missing).toEqual({ checks: "", defaults: "" });
  });

  it("marks views missing when a definition cannot be read", async () => {
    const s = await readSnapshot(fake("postgres", { ddl: async () => "" }));
    expect(s.views).toEqual([]);
    expect(s.missing.views).toBe("no definition for view v_users");
  });

  it("rejects a container that lists schemas instead of tables", async () => {
    const src = fake("postgres", { tree: async () => rs(["name"], [["public"]]) });
    await expect(readSnapshot(src)).rejects.toBeInstanceOf(NotATableListError);
  });

  it("does not read MongoDB at all", async () => {
    const src = fake("mongodb", { tree: async () => Promise.reject(new Error("must not be called")) });
    expect(await readSnapshot(src)).toEqual({ engine: "mongodb", tables: [], views: [], missing: {}, skipped: [] });
  });
});
