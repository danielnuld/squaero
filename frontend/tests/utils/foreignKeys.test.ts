import { describe, it, expect } from "vitest";
import {
  foreignKeysFor,
  sqliteForeignKeySql,
  parseForeignKeys,
} from "../../src/utils/foreignKeys";

describe("foreignKeysFor", () => {
  it("MySQL: bulk query scoped to the database, ordered for composite keys", () => {
    const q = foreignKeysFor("mysql", "shop");
    expect(q.supported).toBe(true);
    expect(q.perTable).toBe(false);
    expect(q.bulkSql).toContain("information_schema.KEY_COLUMN_USAGE");
    expect(q.bulkSql).toContain("TABLE_SCHEMA = 'shop'");
    expect(q.bulkSql).toContain("REFERENCED_TABLE_NAME IS NOT NULL");
    expect(q.bulkSql).toContain("ORDINAL_POSITION");
  });

  it("MySQL: falls back to DATABASE() with no db and treats mariadb the same", () => {
    expect(foreignKeysFor("mysql").bulkSql).toContain("TABLE_SCHEMA = DATABASE()");
    expect(foreignKeysFor("mariadb", "shop").bulkSql).toContain("TABLE_SCHEMA = 'shop'");
  });

  it("PostgreSQL: unnests conkey/confkey and scopes by schema", () => {
    const q = foreignKeysFor("postgres", "public");
    expect(q.supported).toBe(true);
    expect(q.bulkSql).toContain("pg_constraint");
    expect(q.bulkSql).toContain("con.contype = 'f'");
    expect(q.bulkSql).toContain("generate_subscripts(con.conkey, 1)");
    expect(q.bulkSql).toContain("n.nspname = 'public'");
    // no db → excludes the system schemas rather than filtering one
    expect(foreignKeysFor("postgresql").bulkSql).toContain("NOT IN ('pg_catalog'");
  });

  it("Informix: referential constraints joined through sysreferences", () => {
    const q = foreignKeysFor("informix");
    expect(q.supported).toBe(true);
    expect(q.bulkSql).toContain("sysconstraints");
    expect(q.bulkSql).toContain("sysreferences");
    expect(q.bulkSql).toContain("c.constrtype = 'R'");
  });

  it("SQLite: reports per-table (no bulk SQL)", () => {
    const q = foreignKeysFor("sqlite");
    expect(q.supported).toBe(true);
    expect(q.perTable).toBe(true);
    expect(q.bulkSql).toBeNull();
  });

  it("MongoDB: honestly unsupported", () => {
    const q = foreignKeysFor("mongodb");
    expect(q.supported).toBe(false);
    expect(q.bulkSql).toBeNull();
    expect(q.reason).toMatch(/foráneas/i);
  });

  it("unknown engine: unsupported", () => {
    expect(foreignKeysFor("oracle").supported).toBe(false);
  });

  it("escapes a db name for MySQL doubling both quote and backslash (sql_mode)", () => {
    expect(foreignKeysFor("mysql", "o'db\\x").bulkSql).toContain("TABLE_SCHEMA = 'o''db\\\\x'");
  });

  it("does NOT double backslashes for standard-literal engines (postgres)", () => {
    // A backslash is an ordinary character in a standard SQL string literal;
    // doubling it would over-escape and silently fail to match the schema.
    expect(foreignKeysFor("postgres", "a\\b").bulkSql).toContain("n.nspname = 'a\\b'");
  });
});

describe("sqliteForeignKeySql", () => {
  it("builds the per-table pragma, escaping the name", () => {
    expect(sqliteForeignKeySql("orders")).toBe("PRAGMA foreign_key_list('orders')");
    expect(sqliteForeignKeySql("o'r")).toBe("PRAGMA foreign_key_list('o''r')");
  });
});

describe("parseForeignKeys — bulk engines", () => {
  const columns = [
    { name: "from_table" },
    { name: "from_column" },
    { name: "to_table" },
    { name: "to_column" },
  ];

  it("parses each column pair (nominal)", () => {
    const rows = [["orders", "customer_id", "customers", "id"]];
    expect(parseForeignKeys("mysql", columns, rows)).toEqual([
      { fromTable: "orders", fromColumn: "customer_id", toTable: "customers", toColumn: "id" },
    ]);
  });

  it("keeps every row of a composite FK (two column pairs)", () => {
    const rows = [
      ["line", "order_id", "orders", "id"],
      ["line", "order_seq", "orders", "seq"],
    ];
    const fks = parseForeignKeys("postgres", columns, rows);
    expect(fks).toHaveLength(2);
    expect(fks.map((f) => f.fromColumn)).toEqual(["order_id", "order_seq"]);
  });

  it("returns [] when there are no FKs", () => {
    expect(parseForeignKeys("mysql", columns, [])).toEqual([]);
  });

  it("trims Informix-style padded names and drops rows missing a table", () => {
    const rows = [
      ["  order  ", " cust_id ", " client ", " id "],
      [null, "x", "client", "id"], // no source table → dropped
    ];
    const fks = parseForeignKeys("informix", columns, rows);
    expect(fks).toEqual([
      { fromTable: "order", fromColumn: "cust_id", toTable: "client", toColumn: "id" },
    ]);
  });

  it("returns [] when the expected columns are absent", () => {
    expect(parseForeignKeys("mysql", [{ name: "foo" }], [["bar"]])).toEqual([]);
  });
});

describe("parseForeignKeys — SQLite pragma", () => {
  // PRAGMA foreign_key_list columns: id, seq, table (referenced), from, to, …
  const columns = [
    { name: "id" },
    { name: "seq" },
    { name: "table" },
    { name: "from" },
    { name: "to" },
    { name: "on_update" },
    { name: "on_delete" },
    { name: "match" },
  ];

  it("injects the source table (the pragma echoes only the target)", () => {
    const rows = [["0", "0", "customers", "customer_id", "id", "NO ACTION", "NO ACTION", "NONE"]];
    expect(parseForeignKeys("sqlite", columns, rows, "orders")).toEqual([
      { fromTable: "orders", fromColumn: "customer_id", toTable: "customers", toColumn: "id" },
    ]);
  });

  it("tolerates a null 'to' (FK referencing the implicit primary key)", () => {
    const rows = [["0", "0", "customers", "customer_id", null, "NO ACTION", "NO ACTION", "NONE"]];
    const fks = parseForeignKeys("sqlite", columns, rows, "orders");
    expect(fks).toEqual([
      { fromTable: "orders", fromColumn: "customer_id", toTable: "customers", toColumn: "" },
    ]);
  });

  it("returns [] with no source table rows", () => {
    expect(parseForeignKeys("sqlite", columns, [], "orders")).toEqual([]);
  });

  it("drops rows when no source table is supplied (symmetric with the bulk branch)", () => {
    const rows = [["0", "0", "customers", "customer_id", "id", "NO ACTION", "NO ACTION", "NONE"]];
    // Missing sourceTable → fromTable is "" → the row is dropped rather than
    // producing a bogus edge with an empty source.
    expect(parseForeignKeys("sqlite", columns, rows)).toEqual([]);
  });
});
