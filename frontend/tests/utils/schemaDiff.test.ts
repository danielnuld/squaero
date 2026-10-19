import { describe, it, expect } from "vitest";
import {
  parseStructure,
  diffSchemas,
  diffEmpty,
  diffItems,
  generateMigration,
  orderByDependencies,
  viewBody,
  retargetViewDdl,
  isExecutable,
  scriptText,
  type ColumnDef,
  type SchemaSnapshot,
  type TableDef,
} from "../../src/utils/schemaDiff";
import type { ResultSet } from "../../src/utils/query";

function describe_(rows: (string | null)[][]): ResultSet {
  return {
    columns: [
      { name: "name", type: "text" },
      { name: "type", type: "text" },
      { name: "notnull", type: "int" },
      { name: "dflt_value", type: "text" },
      { name: "pk", type: "int" },
    ],
    rows,
    truncated: false,
    rowsAffected: 0,
  };
}

const col = (name: string, type = "INTEGER", extra: Partial<ColumnDef> = {}): ColumnDef => ({
  name,
  type,
  notnull: false,
  pk: false,
  dflt: null,
  ...extra,
});

const table = (name: string, columns: ColumnDef[], extra: Partial<TableDef> = {}): TableDef => ({
  name,
  columns,
  primaryKey: null,
  uniques: [],
  indexes: [],
  foreignKeys: [],
  checks: [],
  ...extra,
});

const snap = (engine: string, tables: TableDef[], extra: Partial<SchemaSnapshot> = {}): SchemaSnapshot => ({
  engine,
  tables,
  views: [],
  missing: {},
  skipped: [],
  ...extra,
});

/** Generate the executable statements for target `engine` (source same engine). */
function script(engine: string, source: TableDef[], target: TableDef[], opts = {}, extra: Partial<SchemaSnapshot> = {}) {
  return generateMigration(diffSchemas(snap(engine, source, extra), snap(engine, target)), opts);
}
const exec = (s: { statements: string[] }) => s.statements.filter(isExecutable);

describe("parseStructure", () => {
  it("reads columns with notnull/pk flags and the default", () => {
    const s = parseStructure(
      describe_([
        ["id", "INTEGER", "1", null, "1"],
        ["name", "TEXT", "0", "'x'", "0"],
      ]),
    );
    expect(s).toEqual([
      { name: "id", type: "INTEGER", notnull: true, pk: true, dflt: null },
      { name: "name", type: "TEXT", notnull: false, pk: false, dflt: "'x'" },
    ]);
  });

  it("returns nothing without a name column", () => {
    expect(parseStructure({ columns: [], rows: [["x"]], truncated: false, rowsAffected: 0 })).toEqual([]);
  });
});

describe("diffSchemas", () => {
  it("splits tables into added, removed and changed", () => {
    const d = diffSchemas(
      snap("sqlite", [table("users", [col("id"), col("email", "TEXT")]), table("orders", [col("id")])]),
      snap("sqlite", [table("users", [col("id"), col("legacy", "TEXT")]), table("audit", [col("id")])]),
    );
    expect(d.addedTables.map((t) => t.name)).toEqual(["orders"]);
    expect(d.removedTables.map((t) => t.name)).toEqual(["audit"]);
    expect(d.changedTables).toHaveLength(1);
    expect(d.changedTables[0].added.map((c) => c.name)).toEqual(["email"]);
    expect(d.changedTables[0].removed.map((c) => c.name)).toEqual(["legacy"]);
  });

  it("detects type, nullability and default changes, ignoring case and spacing", () => {
    const d = diffSchemas(
      snap("postgres", [
        table("t", [
          col("a", "VARCHAR(20)"),
          col("b", "numeric(10, 2)"),
          col("c", "int", { notnull: true }),
          col("d", "int", { dflt: "0" }),
        ]),
      ]),
      snap("postgres", [
        table("T", [
          col("A", "varchar(10)"),
          col("b", "NUMERIC(10,2)"),
          col("c", "INT"),
          col("d", "int", { dflt: "((0))" }),
        ]),
      ]),
    );
    const ch = d.changedTables[0];
    expect(ch.name).toBe("T");
    expect(ch.changed.map((c) => [c.name, c.type, c.nullability, c.dflt])).toEqual([
      ["A", true, false, false],
      ["c", false, true, false],
    ]);
  });

  it("does not compare defaults when a side cannot read them", () => {
    const d = diffSchemas(
      snap("informix", [table("t", [col("a", "INT", { dflt: "1" })])]),
      snap("informix", [table("t", [col("a", "INT")])], { missing: { defaults: "" } }),
    );
    expect(d.changedTables).toEqual([]);
    expect(d.notCompared).toEqual([{ side: "target", engine: "informix", category: "defaults", reason: "" }]);
  });

  it("matches keys, indexes and checks by what they do, not by name", () => {
    const base = [col("id"), col("a"), col("p")];
    const d = diffSchemas(
      snap("postgres", [
        table("t", base, {
          primaryKey: { name: "t_pkey", columns: ["id"] },
          uniques: [{ name: "u1", columns: ["a"] }],
          indexes: [{ name: "ix_new", columns: ["p"], unique: false }],
          foreignKeys: [{ name: "fk_a", columns: ["p"], refTable: "parent", refColumns: ["id"] }],
          checks: [{ name: "c1", expr: "((a > 0))" }],
        }),
      ]),
      snap("postgres", [
        table("t", base, {
          primaryKey: { name: "other_pk", columns: ["ID"] },
          uniques: [{ name: "u_other", columns: ["a"] }],
          indexes: [{ name: "ix_old", columns: ["p"], unique: false }],
          foreignKeys: [{ name: "fk_b", columns: ["p"], refTable: "PARENT", refColumns: ["id"] }],
          checks: [{ name: "c2", expr: "(a>0)" }],
        }),
      ]),
    );
    expect(d.changedTables).toEqual([]);
    expect(diffEmpty(d)).toBe(true);
  });

  it("reports a missing category as not compared and leaves it out of the diff", () => {
    const d = diffSchemas(
      snap("mysql", [table("t", [col("a")], { indexes: [{ name: "i", columns: ["a"], unique: false }] })]),
      snap("mysql", [table("t", [col("a")])], { missing: { indexes: "access denied" } }),
    );
    expect(d.changedTables).toEqual([]);
    expect(d.notCompared).toEqual([
      { side: "target", engine: "mysql", category: "indexes", reason: "access denied" },
    ]);
  });

  it("re-creates a foreign key whose column (or referenced column) changes type", () => {
    const fk = { name: "fk", columns: ["pid"], refTable: "parent", refColumns: ["id"] };
    const d = diffSchemas(
      snap("postgres", [
        table("parent", [col("id", "BIGINT")]),
        table("child", [col("pid", "BIGINT")], { foreignKeys: [fk] }),
      ]),
      snap("postgres", [
        table("parent", [col("id", "INT")]),
        table("child", [col("pid", "INT")], { foreignKeys: [fk] }),
      ]),
    );
    const child = d.changedTables.find((c) => c.name === "child")!;
    expect(child.foreignKeys.removed).toEqual([fk]);
    expect(child.foreignKeys.added).toEqual([fk]);
  });

  it("re-creates a foreign key pointing at a primary key that is replaced", () => {
    const fk = { name: "fk", columns: ["pid"], refTable: "parent", refColumns: ["id"] };
    const d = diffSchemas(
      snap("postgres", [
        table("parent", [col("id"), col("v")], { primaryKey: { name: "pk", columns: ["id", "v"] } }),
        table("child", [col("pid")], { foreignKeys: [fk] }),
      ]),
      snap("postgres", [
        table("parent", [col("id"), col("v")], { primaryKey: { name: "pk", columns: ["id"] } }),
        table("child", [col("pid")], { foreignKeys: [fk] }),
      ]),
    );
    expect(exec(generateMigration(d))).toEqual([
      'ALTER TABLE "child" DROP CONSTRAINT "fk";',
      'ALTER TABLE "parent" DROP CONSTRAINT "pk";',
      'ALTER TABLE "parent" ADD CONSTRAINT "pk" PRIMARY KEY ("id", "v");',
      'ALTER TABLE "child" ADD CONSTRAINT "fk" FOREIGN KEY ("pid") REFERENCES "parent" ("id");',
    ]);
  });

  it("compares views by their query, ignoring header, quoting and spacing", () => {
    const d = diffSchemas(
      snap("mysql", [], {
        views: [
          { name: "v1", ddl: "CREATE VIEW v1 AS SELECT a FROM t" },
          { name: "v2", ddl: "CREATE VIEW v2 AS SELECT b FROM t" },
          { name: "v3", ddl: "CREATE VIEW v3 AS SELECT 1" },
        ],
      }),
      snap("mysql", [], {
        views: [
          { name: "v1", ddl: "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` VIEW `v1` AS select `a`   from `t`;" },
          { name: "v2", ddl: "CREATE VIEW v2 AS SELECT c FROM t" },
          { name: "v4", ddl: "CREATE VIEW v4 AS SELECT 1" },
        ],
      }),
    );
    expect(d.changedViews.map((v) => v.source.name)).toEqual(["v2"]);
    expect(d.addedViews.map((v) => v.name)).toEqual(["v3"]);
    expect(d.removedViews.map((v) => v.name)).toEqual(["v4"]);
  });
});

describe("viewBody", () => {
  it("keeps only the normalized query", () => {
    expect(viewBody('CREATE VIEW "v" AS\n  SELECT "a" FROM t;')).toBe("selectafromt");
  });
});

describe("orderByDependencies", () => {
  it("puts dependencies first along a chain", () => {
    const deps: Record<string, string[]> = { c: ["b"], b: ["a"], a: [] };
    expect(orderByDependencies(["c", "b", "a"], (n) => deps[n])).toEqual({ order: ["a", "b", "c"], cyclic: [] });
  });

  it("ignores self references and names outside the list", () => {
    expect(orderByDependencies(["x", "y"], (n) => (n === "x" ? ["x", "outside", "Y"] : [])).order).toEqual([
      "y",
      "x",
    ]);
  });

  it("appends a cycle (and what depends on it) in input order and reports it", () => {
    const deps: Record<string, string[]> = { a: ["b"], b: ["a"], c: ["a"], d: [] };
    expect(orderByDependencies(["a", "b", "c", "d"], (n) => deps[n])).toEqual({
      order: ["d", "a", "b", "c"],
      cyclic: ["a", "b", "c"],
    });
  });
});

describe("generateMigration — ordering", () => {
  it("creates referenced tables first and adds foreign keys after every table", () => {
    const s = script(
      "postgres",
      [
        table("c", [col("id"), col("b_id")], {
          foreignKeys: [{ name: "c_b", columns: ["b_id"], refTable: "b", refColumns: ["id"] }],
        }),
        table("b", [col("id"), col("a_id")], {
          foreignKeys: [{ name: "b_a", columns: ["a_id"], refTable: "a", refColumns: ["id"] }],
        }),
        table("a", [col("id")]),
      ],
      [],
    );
    const sql = exec(s);
    expect(sql.map((x) => x.split(" (")[0])).toEqual([
      'CREATE TABLE "a"',
      'CREATE TABLE "b"',
      'CREATE TABLE "c"',
      'ALTER TABLE "b" ADD CONSTRAINT "b_a" FOREIGN KEY',
      'ALTER TABLE "c" ADD CONSTRAINT "c_b" FOREIGN KEY',
    ]);
  });

  it("breaks an FK cycle by adding the keys after both tables, and says so", () => {
    const s = script(
      "mysql",
      [
        table("x", [col("id"), col("y_id")], { foreignKeys: [{ columns: ["y_id"], refTable: "y", refColumns: ["id"] }] }),
        table("y", [col("id"), col("x_id")], { foreignKeys: [{ columns: ["x_id"], refTable: "x", refColumns: ["id"] }] }),
      ],
      [],
    );
    const sql = exec(s);
    expect(sql.slice(0, 2).every((x) => x.startsWith("CREATE TABLE"))).toBe(true);
    expect(sql.slice(2)).toEqual([
      "ALTER TABLE `x` ADD FOREIGN KEY (`y_id`) REFERENCES `y` (`id`);",
      "ALTER TABLE `y` ADD FOREIGN KEY (`x_id`) REFERENCES `x` (`id`);",
    ]);
    expect(s.issues.map((i) => i.code)).toContain("fkCycle");
  });

  it("drops foreign keys before the tables, dependents first, only when asked", () => {
    const target = [
      table("parent", [col("id")], { primaryKey: { name: "parent_pkey", columns: ["id"] } }),
      table("child", [col("id"), col("pid")], {
        foreignKeys: [{ name: "child_pid", columns: ["pid"], refTable: "parent", refColumns: ["id"] }],
      }),
    ];
    expect(exec(script("postgres", [], target))).toEqual([]);
    expect(script("postgres", [], target).issues.map((i) => [i.code, i.object])).toEqual([
      ["dropTableSkipped", "parent"],
      ["dropTableSkipped", "child"],
    ]);
    expect(exec(script("postgres", [], target, { dropTables: true }))).toEqual([
      'ALTER TABLE "child" DROP CONSTRAINT "child_pid";',
      'DROP TABLE "child";',
      'DROP TABLE "parent";',
    ]);
  });

  it("re-creates an unchanged view that reads a table losing a column", () => {
    const view = { name: "v", ddl: "CREATE VIEW v AS SELECT a FROM t" };
    const d = diffSchemas(
      snap("postgres", [table("t", [col("a")])], { views: [view] }),
      snap("postgres", [table("t", [col("a"), col("b")])], { views: [view] }),
    );
    expect(exec(generateMigration(d))).toEqual([
      'DROP VIEW "v";',
      'ALTER TABLE "t" DROP COLUMN "b";',
      'CREATE VIEW "v" AS SELECT a FROM t;',
    ]);
  });

  it("drops views first and creates them last, the views they read first", () => {
    const tables = [table("t", [col("a")])];
    const d = diffSchemas(
      snap("postgres", [table("t", [col("a"), col("b")])], {
        views: [
          { name: "v_top", ddl: "CREATE VIEW v_top AS SELECT * FROM v_base" },
          { name: "v_base", ddl: "CREATE VIEW v_base AS SELECT a, b FROM t" },
        ],
      }),
      snap("postgres", tables, {
        views: [
          { name: "v_top", ddl: "CREATE VIEW v_top AS SELECT * FROM v_base" },
          { name: "v_base", ddl: "CREATE VIEW v_base AS SELECT a FROM t" },
        ],
      }),
    );
    expect(exec(generateMigration(d))).toEqual([
      'DROP VIEW "v_top";',
      'DROP VIEW "v_base";',
      'ALTER TABLE "t" ADD COLUMN "b" INTEGER;',
      'CREATE VIEW "v_base" AS SELECT a, b FROM t;',
      'CREATE VIEW "v_top" AS SELECT * FROM v_base;',
    ]);
  });
});

describe("generateMigration — per engine", () => {
  // The same change on every engine: users gains `email` (NOT NULL, default),
  // `name` widens and becomes NOT NULL, `legacy` goes away; an index and a FK
  // are replaced; a unique constraint is added.
  const source = [
    table("users", [col("id"), col("name", "VARCHAR(100)", { notnull: true }), col("email", "VARCHAR(50)", { notnull: true, dflt: "''" }), col("org_id")], {
      primaryKey: { name: "users_pk", columns: ["id"] },
      uniques: [{ name: "users_email_uq", columns: ["email"] }],
      indexes: [{ name: "users_org_ix", columns: ["org_id", "name"], unique: false }],
      foreignKeys: [{ name: "users_org_fk", columns: ["org_id"], refTable: "orgs", refColumns: ["id"] }],
    }),
  ];
  const target = [
    table("users", [col("id"), col("name", "VARCHAR(50)"), col("legacy", "TEXT"), col("org_id")], {
      primaryKey: { name: "users_pk", columns: ["id"] },
      indexes: [{ name: "users_org_ix", columns: ["org_id"], unique: false }],
      foreignKeys: [{ name: "users_org_old", columns: ["org_id"], refTable: "orgs_old", refColumns: ["id"] }],
    }),
  ];

  it("postgres: ALTER COLUMN per attribute, schema-qualified", () => {
    expect(exec(script("postgres", source, target, { container: { schema: "app" } }))).toEqual([
      'ALTER TABLE "app"."users" DROP CONSTRAINT "users_org_old";',
      'DROP INDEX "app"."users_org_ix";',
      `ALTER TABLE "app"."users" ADD COLUMN "email" VARCHAR(50) DEFAULT '' NOT NULL;`,
      'ALTER TABLE "app"."users" ALTER COLUMN "name" TYPE VARCHAR(100);',
      'ALTER TABLE "app"."users" ALTER COLUMN "name" SET NOT NULL;',
      'ALTER TABLE "app"."users" DROP COLUMN "legacy";',
      'ALTER TABLE "app"."users" ADD CONSTRAINT "users_email_uq" UNIQUE ("email");',
      'CREATE INDEX "users_org_ix" ON "app"."users" ("org_id", "name");',
      'ALTER TABLE "app"."users" ADD CONSTRAINT "users_org_fk" FOREIGN KEY ("org_id") REFERENCES "app"."orgs" ("id");',
    ]);
  });

  it("mysql: MODIFY COLUMN, type-specific drops, backticks, db-qualified", () => {
    expect(exec(script("mysql", source, target, { container: { db: "shop" } }))).toEqual([
      "ALTER TABLE `shop`.`users` DROP FOREIGN KEY `users_org_old`;",
      "DROP INDEX `users_org_ix` ON `shop`.`users`;",
      "ALTER TABLE `shop`.`users` ADD COLUMN `email` VARCHAR(50) DEFAULT '' NOT NULL;",
      "ALTER TABLE `shop`.`users` MODIFY COLUMN `name` VARCHAR(100) NOT NULL;",
      "ALTER TABLE `shop`.`users` DROP COLUMN `legacy`;",
      "ALTER TABLE `shop`.`users` ADD CONSTRAINT `users_email_uq` UNIQUE (`email`);",
      "CREATE INDEX `users_org_ix` ON `shop`.`users` (`org_id`, `name`);",
      "ALTER TABLE `shop`.`users` ADD CONSTRAINT `users_org_fk` FOREIGN KEY (`org_id`) REFERENCES `shop`.`orgs` (`id`);",
    ]);
  });

  it("mssql: ALTER COLUMN with nullability, ADD without COLUMN, brackets", () => {
    expect(exec(script("mssql", source, target, { container: { schema: "dbo" } }))).toEqual([
      "ALTER TABLE [dbo].[users] DROP CONSTRAINT [users_org_old];",
      "DROP INDEX [users_org_ix] ON [dbo].[users];",
      "ALTER TABLE [dbo].[users] ADD [email] VARCHAR(50) DEFAULT '' NOT NULL;",
      "ALTER TABLE [dbo].[users] ALTER COLUMN [name] VARCHAR(100) NOT NULL;",
      "ALTER TABLE [dbo].[users] DROP COLUMN [legacy];",
      "ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_email_uq] UNIQUE ([email]);",
      "CREATE INDEX [users_org_ix] ON [dbo].[users] ([org_id], [name]);",
      "ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_org_fk] FOREIGN KEY ([org_id]) REFERENCES [dbo].[orgs] ([id]);",
    ]);
  });

  it("mssql: a changed default is reported, not guessed", () => {
    const s = script("mssql", [table("t", [col("a", "INT", { dflt: "((1))" })])], [table("t", [col("a", "INT", { dflt: "((0))" })])]);
    expect(exec(s)).toEqual([]);
    expect(s.issues).toEqual([{ kind: "unsupported", code: "mssqlDefault", object: "t.a", detail: "DEFAULT ((1))" }]);
    expect(s.statements[0]).toMatch(/^-- UNSUPPORTED: t\.a: SQL Server keeps defaults/);
  });

  it("informix: MODIFY (...), constraint name after the body, db:table", () => {
    const s = script("informix", source, target, { container: { db: "stores" } });
    expect(exec(s)).toEqual([
      "ALTER TABLE stores:users DROP CONSTRAINT users_org_old;",
      "DROP INDEX stores:users_org_ix;",
      "ALTER TABLE stores:users ADD email VARCHAR(50) DEFAULT '' NOT NULL;",
      "ALTER TABLE stores:users MODIFY (name VARCHAR(100) NOT NULL);",
      "ALTER TABLE stores:users DROP legacy;",
      "ALTER TABLE stores:users ADD CONSTRAINT UNIQUE (email) CONSTRAINT users_email_uq;",
      "CREATE INDEX users_org_ix ON stores:users (org_id, name);",
      "ALTER TABLE stores:users ADD CONSTRAINT FOREIGN KEY (org_id) REFERENCES stores:orgs (id) CONSTRAINT users_org_fk;",
    ]);
    expect(s.issues.map((i) => i.code)).toEqual(["informixModify"]);
  });

  it("sqlite: indexes and columns where possible, the rest flagged UNSUPPORTED", () => {
    const s = script("sqlite", source, target);
    expect(exec(s)).toEqual([
      'DROP INDEX "users_org_ix";',
      'ALTER TABLE "users" ADD COLUMN "email" VARCHAR(50) DEFAULT \'\' NOT NULL;',
      'ALTER TABLE "users" DROP COLUMN "legacy";',
      'CREATE INDEX "users_org_ix" ON "users" ("org_id", "name");',
    ]);
    expect(s.issues.map((i) => [i.kind, i.code, i.object])).toEqual([
      ["unsupported", "sqliteConstraint", "users"], // drop old FK
      ["unsupported", "sqliteAlterColumn", "users.name"],
      ["unsupported", "sqliteConstraint", "users"], // add unique
      ["unsupported", "sqliteConstraint", "users"], // add FK
    ]);
    expect(s.statements.filter((x) => x.startsWith("-- UNSUPPORTED:"))).toHaveLength(4);
  });

  it("sqlite: a NOT NULL column without default cannot be added", () => {
    const s = script("sqlite", [table("t", [col("a"), col("b", "TEXT", { notnull: true })])], [table("t", [col("a")])]);
    expect(exec(s)).toEqual([]);
    expect(s.issues[0]).toMatchObject({ kind: "unsupported", code: "sqliteNotNullColumn", object: "t.b" });
  });

  it("sqlite: a new table declares its foreign keys inline", () => {
    const s = script(
      "sqlite",
      [
        table("child", [col("id"), col("pid")], {
          primaryKey: { columns: ["id"] },
          foreignKeys: [{ columns: ["pid"], refTable: "parent", refColumns: ["id"] }],
          checks: [{ expr: "pid > 0" }],
        }),
      ],
      [],
    );
    expect(exec(s)).toEqual([
      'CREATE TABLE "child" (\n' +
        '  "id" INTEGER,\n' +
        '  "pid" INTEGER,\n' +
        '  PRIMARY KEY ("id"),\n' +
        "  CHECK (pid > 0),\n" +
        '  FOREIGN KEY ("pid") REFERENCES "parent" ("id")\n' +
        ");",
    ]);
  });

  it("changes a primary key: drop then add (mysql has no key name)", () => {
    const s = script(
      "mysql",
      [table("t", [col("a"), col("b")], { primaryKey: { columns: ["a", "b"] } })],
      [table("t", [col("a"), col("b")], { primaryKey: { columns: ["a"] } })],
    );
    expect(exec(s)).toEqual(["ALTER TABLE `t` DROP PRIMARY KEY;", "ALTER TABLE `t` ADD PRIMARY KEY (`a`, `b`);"]);
  });

  it("reports a constraint it cannot drop for lack of a name", () => {
    const s = script(
      "postgres",
      [table("t", [col("a")])],
      [table("t", [col("a")], { primaryKey: { columns: ["a"] } })],
    );
    expect(exec(s)).toEqual([]);
    expect(s.issues[0]).toMatchObject({ kind: "unsupported", code: "noConstraintName", object: "t" });
  });

  it("drops a check with the engine's syntax", () => {
    const src = [table("t", [col("a")])];
    const tgt = [table("t", [col("a")], { checks: [{ name: "ck", expr: "a > 0" }] })];
    expect(exec(script("mysql", src, tgt))).toEqual(["ALTER TABLE `t` DROP CHECK `ck`;"]);
    expect(exec(script("mssql", src, tgt))).toEqual(["ALTER TABLE [t] DROP CONSTRAINT [ck];"]);
  });

  it("refuses MongoDB on either side", () => {
    for (const [s, t] of [["mongodb", "postgres"], ["postgres", "mongodb"]]) {
      const out = generateMigration(diffSchemas(snap(s, [table("a", [col("x")])]), snap(t, [])));
      expect(exec(out)).toEqual([]);
      expect(out.issues).toEqual([{ kind: "unsupported", code: "mongodb", object: "mongodb", detail: undefined }]);
    }
  });
});

describe("generateMigration — notes", () => {
  it("notes a possible rename instead of guessing it", () => {
    const s = script("postgres", [table("t", [col("full_name", "TEXT")])], [table("t", [col("name", "TEXT")])]);
    expect(exec(s)).toEqual([
      'ALTER TABLE "t" ADD COLUMN "full_name" TEXT;',
      'ALTER TABLE "t" DROP COLUMN "name";',
    ]);
    expect(s.issues).toEqual([{ kind: "note", code: "possibleRename", object: "t", detail: "name -> full_name" }]);
  });

  it("heads the script with what was not compared, skipped, or crosses engines", () => {
    const d = diffSchemas(
      snap("sqlite", [], { missing: { checks: "" }, skipped: ["t.ix_expr"] }),
      snap("postgres", [], { missing: { views: "permission denied" } }),
    );
    const s = generateMigration(d);
    expect(s.statements).toEqual([
      "-- NOTE: checks not compared (source, sqlite: no catalog for this engine)",
      "-- NOTE: views not compared (target, postgres: permission denied)",
      "-- NOTE: t.ix_expr: index on expressions, partial or not B-tree; not compared",
      "-- NOTE: sqlite -> postgres: different engines: types, defaults, checks and view definitions are copied verbatim; review them",
    ]);
    expect(s.issues[0]).toEqual({ kind: "note", code: "notCompared", object: "checks", detail: "", side: "source" });
  });
});

describe("diffItems", () => {
  it("flattens a diff into categorized lines", () => {
    const d = diffSchemas(
      snap("postgres", [
        table("t", [col("a", "BIGINT"), col("b")], {
          primaryKey: { columns: ["a"] },
          indexes: [{ name: "ix", columns: ["b"], unique: true }],
          foreignKeys: [{ name: "fk", columns: ["b"], refTable: "p", refColumns: ["id"] }],
        }),
        table("n", [col("x")]),
      ], { views: [{ name: "v", ddl: "CREATE VIEW v AS SELECT 1" }] }),
      snap("postgres", [table("t", [col("a"), col("c")]), table("old", [col("x")])]),
    );
    expect(diffItems(d)).toEqual([
      { kind: "table", change: "added", name: "n" },
      { kind: "table", change: "removed", name: "old" },
      { kind: "column", change: "added", name: "t.b", detail: "INTEGER" },
      { kind: "column", change: "removed", name: "t.c", detail: "INTEGER" },
      { kind: "column", change: "changed", name: "t.a", detail: "INTEGER -> BIGINT" },
      { kind: "primaryKey", change: "added", name: "t", detail: "- -> (a)" },
      { kind: "index", change: "added", name: "t.ix (b)" },
      { kind: "foreignKey", change: "added", name: "t.fk (b) -> p(id)" },
      { kind: "view", change: "added", name: "v" },
    ]);
  });
});

describe("script helpers", () => {
  it("tells statements from comments and joins the script", () => {
    expect(isExecutable('CREATE TABLE "x" ()')).toBe(true);
    expect(isExecutable("  -- note")).toBe(false);
    expect(scriptText({ statements: ["-- a", "B;"], issues: [] })).toBe("-- a\nB;\n");
    expect(scriptText({ statements: [], issues: [] })).toBe("");
  });
});

describe("views land in the target container (#770)", () => {
  const t = [table("clientes", [col("id")])];
  const mysqlView = {
    name: "ventas_por_ciudad",
    ddl:
      "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `ventas_por_ciudad` AS " +
      "select `c`.`ciudad` AS `ciudad` from `clientes` `c`",
  };

  it("mysql: USE the target database, then the view qualified with it", () => {
    const s = script("mysql", t, t, { container: { db: "demo_dst" } }, { views: [mysqlView] });
    expect(exec(s)).toEqual([
      "USE `demo_dst`;",
      "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `demo_dst`.`ventas_por_ciudad` AS " +
        "select `c`.`ciudad` AS `ciudad` from `clientes` `c`;",
    ]);
  });

  it("mysql: a body qualified with the source database reads the target's tables", () => {
    const view = { name: "v", ddl: "CREATE VIEW `demo_src`.`v` AS select * from `demo_src`.`clientes` join demo_src.pedidos" };
    const s = script("mysql", t, t, { container: { db: "demo_dst" }, sourceContainer: { db: "demo_src" } }, { views: [view] });
    expect(exec(s)).toEqual([
      "USE `demo_dst`;",
      "CREATE VIEW `demo_dst`.`v` AS select * from `demo_dst`.`clientes` join `demo_dst`.pedidos;",
    ]);
  });

  it("postgres: SET search_path to the target schema, view schema-qualified", () => {
    const view = { name: "v", ddl: 'CREATE VIEW "app_src"."v" AS SELECT id FROM app_src.clientes' };
    const s = script("postgres", t, t, { container: { schema: "app" }, sourceContainer: { schema: "app_src" } }, { views: [view] });
    expect(exec(s)).toEqual(['SET search_path TO "app";', 'CREATE VIEW "app"."v" AS SELECT id FROM "app".clientes;']);
  });

  it("no context statement without a target container or without views", () => {
    expect(exec(script("postgres", t, t, {}, { views: [{ name: "v", ddl: "CREATE VIEW v AS SELECT 1" }] }))).toEqual([
      'CREATE VIEW "v" AS SELECT 1;',
    ]);
    expect(exec(script("mysql", t, [], { container: { db: "d" } }))[0]).not.toMatch(/^USE/);
  });
});

describe("retargetViewDdl", () => {
  it("replaces a quoted, qualified or IF NOT EXISTS name", () => {
    expect(retargetViewDdl('CREATE VIEW IF NOT EXISTS "s"."v" AS SELECT 1', '"t"."v"', undefined, undefined, "sqlite")).toBe(
      'CREATE VIEW IF NOT EXISTS "t"."v" AS SELECT 1',
    );
    expect(retargetViewDdl("create or replace view [dbo].[v] as select 1", "[x].[v]", undefined, undefined, "mssql")).toBe(
      "create or replace view [x].[v] as select 1",
    );
  });

  it("drops the source qualifier when the target has none, and leaves lookalikes alone", () => {
    expect(retargetViewDdl("CREATE VIEW v AS SELECT src.a, mysrc.b FROM src.t", "v", "src", undefined, "postgres")).toBe(
      "CREATE VIEW v AS SELECT a, mysrc.b FROM t",
    );
  });

  it("is a no-op for the body when source and target are the same container", () => {
    expect(retargetViewDdl("CREATE VIEW v AS SELECT * FROM app.t", '"app"."v"', "app", "APP", "postgres")).toBe(
      'CREATE VIEW "app"."v" AS SELECT * FROM app.t',
    );
  });
});
