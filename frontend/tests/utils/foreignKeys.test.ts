import { describe, it, expect } from "vitest";
import {
  foreignKeysFor,
  groupForeignKeys,
  parseForeignKeys,
  type ForeignKey,
} from "../../src/utils/foreignKeys";

// Scoping the catalog to ONE table is not an optimization: query.run caps the
// rows it returns, so in a schema with thousands of foreign keys an unscoped
// listing loses its tail and the edited table can vanish from the answer (the
// LG_Documento bug — no picker, because its keys were past the cap).
describe("foreignKeysFor — scoped to one table", () => {
  const from = (table: string) => ({ table, direction: "from" as const });

  it("MySQL filters by table name, escaping the literal", () => {
    expect(foreignKeysFor("mysql", "shop", from("LG_Documento")).bulkSql).toContain(
      "AND TABLE_NAME = 'LG_Documento'",
    );
    expect(foreignKeysFor("mysql", "shop", from("o'b\\r")).bulkSql).toContain(
      "AND TABLE_NAME = 'o''b\\\\r'",
    );
  });
  it("PostgreSQL filters by relation name", () => {
    expect(foreignKeysFor("postgres", "public", from("pedidos")).bulkSql).toContain(
      "AND cl.relname = 'pedidos'",
    );
  });
  it("Informix filters by tabname", () => {
    expect(foreignKeysFor("informix", undefined, from("pedidos")).bulkSql).toContain(
      "AND t.tabname = 'pedidos'",
    );
  });
  // #552: a table opened from another database of the server showed no
  // relations, because its catalog was read from the connection's database.
  it("Informix reads the catalog of the table's own database", () => {
    const sql = foreignKeysFor("informix", "otra552", from("recursos")).bulkSql!;
    for (const table of ["sysconstraints", "systables", "sysreferences", "sysindexes", "syscolumns"]) {
      expect(sql).toContain(`otra552:${table} `);
    }
    expect(sql).not.toMatch(/(FROM|JOIN) sys/);
    // Not a plain identifier: no qualifier rather than an injected one.
    const odd = foreignKeysFor("informix", "x; DROP", from("recursos")).bulkSql!;
    expect(odd).not.toContain("DROP");
    expect(foreignKeysFor("informix", undefined, from("recursos")).bulkSql).toContain("FROM sysconstraints c ");
  });
  it("SQLite filters by the child table", () => {
    expect(foreignKeysFor("sqlite", undefined, from("pedidos")).bulkSql).toContain(
      "AND m.name = 'pedidos'",
    );
  });
  it("omitting the table still lists the whole database (the ER diagram)", () => {
    expect(foreignKeysFor("mysql", "shop").bulkSql).not.toContain("AND TABLE_NAME =");
    expect(foreignKeysFor("postgres", "public").bulkSql).not.toContain("AND cl.relname =");
  });
});

// The inbound direction is what "related data" needs: not the keys leaving a
// table, but the ones pointing AT it (issue #310).
describe("foreignKeysFor — inbound direction", () => {
  const to = (table: string) => ({ table, direction: "to" as const });

  it("MySQL filters by the referenced table", () => {
    const sql = foreignKeysFor("mysql", "shop", to("cuadernos")).bulkSql!;
    expect(sql).toContain("AND REFERENCED_TABLE_NAME = 'cuadernos'");
    expect(sql).not.toContain("AND TABLE_NAME = 'cuadernos'");
  });

  it("PostgreSQL filters by the referenced relation", () => {
    const sql = foreignKeysFor("postgres", "public", to("cuadernos")).bulkSql!;
    expect(sql).toContain("AND cf.relname = 'cuadernos'");
    expect(sql).not.toContain("AND cl.relname = 'cuadernos'");
  });

  it("Informix filters by the parent table", () => {
    const sql = foreignKeysFor("informix", undefined, to("cuadernos")).bulkSql!;
    expect(sql).toContain("AND pt.tabname = 'cuadernos'");
    expect(sql).not.toContain("AND t.tabname = 'cuadernos'");
  });

  it("SQLite filters by the referenced table of the pragma", () => {
    const sql = foreignKeysFor("sqlite", undefined, to("cuadernos")).bulkSql!;
    expect(sql).toContain(`AND f."table" = 'cuadernos'`);
  });
});

describe("foreignKeysFor", () => {
  it("MySQL: bulk query scoped to the database, ordered for composite keys", () => {
    const q = foreignKeysFor("mysql", "shop");
    expect(q.supported).toBe(true);
    expect(q.bulkSql).toContain("information_schema.KEY_COLUMN_USAGE");
    expect(q.bulkSql).toContain("TABLE_SCHEMA = 'shop'");
    expect(q.bulkSql).toContain("REFERENCED_TABLE_NAME IS NOT NULL");
    expect(q.bulkSql).toContain("ORDINAL_POSITION");
    // The constraint identity travels, so composite keys can be regrouped.
    expect(q.bulkSql).toContain("CONSTRAINT_NAME AS constraint_name");
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
    expect(q.bulkSql).toContain("con.conname AS constraint_name");
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

  it("Informix: resolves every key position, not just part1", () => {
    const sql = foreignKeysFor("informix").bulkSql!;
    // One branch per index position, both sides, skipping the unused positions.
    expect(sql).toContain("ABS(fi.part1)");
    expect(sql).toContain("ABS(pi.part16)");
    expect(sql).toContain("AND fi.part5 <> 0 AND pi.part5 <> 0");
    expect(sql.match(/UNION ALL/g)).toHaveLength(15);
    // Ordered by table, constraint and position so composite keys stay ordered.
    expect(sql.endsWith("ORDER BY 1, 5, 6")).toBe(true);
  });

  it("SQLite: one query through the pragma table-valued function", () => {
    const q = foreignKeysFor("sqlite");
    expect(q.supported).toBe(true);
    expect(q.bulkSql).toContain("pragma_foreign_key_list(m.name)");
    expect(q.bulkSql).toContain("sqlite_master");
    expect(q.bulkSql).toContain("m.name NOT LIKE 'sqlite_%'");
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

describe("parseForeignKeys", () => {
  const columns = [
    { name: "from_table" },
    { name: "from_column" },
    { name: "to_table" },
    { name: "to_column" },
    { name: "constraint_name" },
    { name: "position" },
  ];

  it("parses each column pair with its constraint and position (nominal)", () => {
    const rows = [["orders", "customer_id", "customers", "id", "fk_ord_cust", "1"]];
    expect(parseForeignKeys(columns, rows)).toEqual([
      {
        fromTable: "orders",
        fromColumn: "customer_id",
        toTable: "customers",
        toColumn: "id",
        constraint: "fk_ord_cust",
        position: 1,
      },
    ]);
  });

  it("keeps every row of a composite FK (two column pairs)", () => {
    const rows = [
      ["line", "order_id", "orders", "id", "fk_line", "1"],
      ["line", "order_seq", "orders", "seq", "fk_line", "2"],
    ];
    const fks = parseForeignKeys(columns, rows);
    expect(fks).toHaveLength(2);
    expect(fks.map((f) => f.fromColumn)).toEqual(["order_id", "order_seq"]);
  });

  it("works without the constraint columns (older catalogs)", () => {
    const bare = columns.slice(0, 4);
    const fks = parseForeignKeys(bare, [["orders", "customer_id", "customers", "id"]]);
    expect(fks[0].constraint).toBeUndefined();
    expect(fks[0].position).toBeUndefined();
  });

  it("returns [] when there are no FKs", () => {
    expect(parseForeignKeys(columns, [])).toEqual([]);
  });

  it("trims Informix-style padded names and drops rows missing a table", () => {
    const rows = [
      ["  order  ", " cust_id ", " client ", " id ", " fk_o ", "1"],
      [null, "x", "client", "id", "fk_x", "1"], // no source table → dropped
    ];
    const fks = parseForeignKeys(columns, rows);
    expect(fks).toHaveLength(1);
    expect(fks[0]).toMatchObject({ fromTable: "order", fromColumn: "cust_id", toTable: "client" });
  });

  it("tolerates a null 'to' (SQLite FK referencing the implicit primary key)", () => {
    const rows = [["orders", "customer_id", "customers", null, "0", "0"]];
    expect(parseForeignKeys(columns, rows)[0].toColumn).toBe("");
  });

  it("returns [] when the expected columns are absent", () => {
    expect(parseForeignKeys([{ name: "foo" }], [["bar"]])).toEqual([]);
  });
});

describe("groupForeignKeys", () => {
  const pair = (over: Partial<ForeignKey>): ForeignKey => ({
    fromTable: "cuaderno_imputado",
    fromColumn: "ciudad",
    toTable: "cuadernos",
    toColumn: "ciudad",
    ...over,
  });

  it("groups a composite key into one relationship with its columns in order", () => {
    const fks = [
      pair({ fromColumn: "ciudad", toColumn: "ciudad", constraint: "fk_ci", position: 1 }),
      pair({ fromColumn: "anio_cuad", toColumn: "anio_cuad", constraint: "fk_ci", position: 2 }),
      pair({ fromColumn: "cuaderno", toColumn: "cuaderno", constraint: "fk_ci", position: 3 }),
    ];
    const rels = groupForeignKeys(fks);
    expect(rels).toHaveLength(1);
    expect(rels[0].fromTable).toBe("cuaderno_imputado");
    expect(rels[0].toTable).toBe("cuadernos");
    expect(rels[0].columns.map((c) => c.from)).toEqual(["ciudad", "anio_cuad", "cuaderno"]);
  });

  it("orders the columns by catalog position, not row order", () => {
    const fks = [
      pair({ fromColumn: "b", constraint: "fk", position: 2 }),
      pair({ fromColumn: "a", constraint: "fk", position: 1 }),
    ];
    expect(groupForeignKeys(fks)[0].columns.map((c) => c.from)).toEqual(["a", "b"]);
  });

  it("keeps two constraints to the same table apart", () => {
    const fks = [
      pair({ fromColumn: "alta_por", constraint: "fk_alta", position: 1 }),
      pair({ fromColumn: "baja_por", constraint: "fk_baja", position: 1 }),
    ];
    const rels = groupForeignKeys(fks);
    expect(rels).toHaveLength(2);
    expect(rels.map((r) => r.constraint)).toEqual(["fk_alta", "fk_baja"]);
  });

  it("keeps the same constraint name in different tables apart", () => {
    const fks = [
      pair({ fromTable: "a", constraint: "fk", position: 1 }),
      pair({ fromTable: "b", constraint: "fk", position: 1 }),
    ];
    expect(groupForeignKeys(fks).map((r) => r.fromTable)).toEqual(["a", "b"]);
  });

  it("falls back to the target table when the catalog gave no constraint", () => {
    const fks = [pair({ fromColumn: "ciudad" }), pair({ fromColumn: "anio_cuad" })];
    const rels = groupForeignKeys(fks);
    expect(rels).toHaveLength(1);
    expect(rels[0].constraint).toBe("cuadernos");
    expect(rels[0].columns).toHaveLength(2);
  });

  it("returns [] for no keys", () => {
    expect(groupForeignKeys([])).toEqual([]);
  });
});
