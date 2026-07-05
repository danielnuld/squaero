import { describe, it, expect } from "vitest";
import {
  buildAlterTable,
  buildCreateTable,
  columnsFromDescribe,
  type AlterColumn,
  type AlterTableDef,
  type ColumnDef,
  type OriginalColumn,
  type OriginalTable,
  type TableDef,
} from "../../src/utils/tableDesign";
import type { ResultSet } from "../../src/utils/query";

const col = (over: Partial<ColumnDef>): ColumnDef => ({
  name: "c",
  type: "INT",
  nullable: true,
  primaryKey: false,
  autoIncrement: false,
  defaultValue: "",
  ...over,
});

const def = (over: Partial<TableDef>): TableDef => ({ name: "t", columns: [col({})], ...over });

describe("buildCreateTable — SQL", () => {
  it("MySQL: backticks, AUTO_INCREMENT PK, NOT NULL, DEFAULT", () => {
    const r = buildCreateTable("mysql", {
      name: "users",
      columns: [
        col({ name: "id", type: "INT", nullable: false, primaryKey: true, autoIncrement: true }),
        col({ name: "name", type: "VARCHAR(255)", nullable: false }),
        col({ name: "active", type: "TINYINT", defaultValue: "1" }),
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.sql).toBe(
        "CREATE TABLE `users` (\n" +
          "  `id` INT NOT NULL AUTO_INCREMENT,\n" +
          "  `name` VARCHAR(255) NOT NULL,\n" +
          "  `active` TINYINT DEFAULT 1,\n" +
          "  PRIMARY KEY (`id`)\n)",
      );
  });

  it("SQLite: INTEGER PRIMARY KEY AUTOINCREMENT inline (no separate PK)", () => {
    const r = buildCreateTable("sqlite", {
      name: "t",
      columns: [
        col({ name: "id", type: "INTEGER", nullable: false, primaryKey: true, autoIncrement: true }),
        col({ name: "label", type: "TEXT" }),
      ],
    });
    expect(r.ok && r.sql).toBe(
      'CREATE TABLE "t" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "label" TEXT\n)',
    );
  });

  it("Informix: bare identifiers and SERIAL for auto-increment", () => {
    const r = buildCreateTable("informix", {
      name: "t",
      columns: [col({ name: "id", type: "INTEGER", nullable: false, primaryKey: true, autoIncrement: true })],
    });
    expect(r.ok && r.sql).toBe("CREATE TABLE t (\n  id SERIAL NOT NULL,\n  PRIMARY KEY (id)\n)");
  });

  it("qualifies the name with the container database when given", () => {
    const r = buildCreateTable("mysql", {
      name: "t",
      container: "testdb",
      columns: [col({ name: "id", type: "INT" })],
    });
    expect(r.ok && r.sql.startsWith("CREATE TABLE `testdb`.`t` (")).toBe(true);
  });

  it("composite primary key as a table-level constraint", () => {
    const r = buildCreateTable("mysql", {
      name: "t",
      columns: [
        col({ name: "a", type: "INT", primaryKey: true }),
        col({ name: "b", type: "INT", primaryKey: true }),
      ],
    });
    expect(r.ok && r.sql.includes("PRIMARY KEY (`a`, `b`)")).toBe(true);
  });
});

describe("buildCreateTable — validation", () => {
  const bad = (engine: string, d: TableDef) => {
    const r = buildCreateTable(engine, d);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.error;
  };

  it("requires a table name", () => {
    expect(bad("mysql", def({ name: "  " }))).toMatch(/nombre de la tabla/i);
  });
  it("requires at least one column", () => {
    expect(bad("mysql", def({ columns: [] }))).toMatch(/al menos una columna/i);
  });
  it("requires each column to have a name and type", () => {
    expect(bad("mysql", def({ columns: [col({ name: "" })] }))).toMatch(/nombre/i);
    expect(bad("mysql", def({ columns: [col({ type: "" })] }))).toMatch(/tipo/i);
  });
  it("rejects duplicate column names", () => {
    expect(bad("mysql", def({ columns: [col({ name: "x" }), col({ name: "X" })] }))).toMatch(/duplicad/i);
  });
  it("auto-increment must be a primary key", () => {
    expect(bad("mysql", def({ columns: [col({ name: "id", autoIncrement: true })] }))).toMatch(/clave primaria/i);
  });
  it("MySQL allows only one AUTO_INCREMENT column", () => {
    expect(
      bad("mysql", def({
        columns: [
          col({ name: "a", primaryKey: true, autoIncrement: true }),
          col({ name: "b", primaryKey: true, autoIncrement: true }),
        ],
      })),
    ).toMatch(/AUTO_INCREMENT/);
  });
});

// ─── Phase 2: ALTER ─────────────────────────────────────────────────────────

const oc = (
  name: string,
  type: string,
  nullable = true,
  defaultValue = "",
): OriginalColumn => ({ name, type, nullable, defaultValue });

/** An alter column derived from an original one (unchanged unless overridden). */
const from = (o: OriginalColumn, over: Partial<AlterColumn> = {}): AlterColumn => ({
  origName: o.name,
  name: o.name,
  type: o.type,
  nullable: o.nullable,
  primaryKey: false,
  autoIncrement: false,
  defaultValue: o.defaultValue,
  ...over,
});

/** A freshly added alter column (no origName). */
const added = (over: Partial<AlterColumn>): AlterColumn => ({
  name: "c",
  type: "INT",
  nullable: true,
  primaryKey: false,
  autoIncrement: false,
  defaultValue: "",
  ...over,
});

const orig = (over: Partial<OriginalTable> = {}): OriginalTable => ({
  name: "users",
  columns: [oc("id", "INT", false), oc("name", "VARCHAR(255)")],
  ...over,
});

const edit = (over: Partial<AlterTableDef>): AlterTableDef => ({
  name: "users",
  columns: orig().columns.map((c) => from(c)),
  ...over,
});

const stmts = (engine: string, o: OriginalTable, e: AlterTableDef): string[] => {
  const r = buildAlterTable(engine, o, e);
  expect(r.ok).toBe(true);
  return r.ok ? r.statements : [];
};

describe("buildAlterTable", () => {
  it("emits nothing when the edited form matches the original", () => {
    expect(stmts("mysql", orig(), edit({}))).toEqual([]);
  });

  it("MySQL: add a column", () => {
    const e = edit({ columns: [...orig().columns.map((c) => from(c)), added({ name: "age", type: "INT" })] });
    expect(stmts("mysql", orig(), e)).toEqual(["ALTER TABLE `users` ADD COLUMN `age` INT"]);
  });

  it("MySQL: drop a removed column", () => {
    const e = edit({ columns: [from(oc("id", "INT", false))] });
    expect(stmts("mysql", orig(), e)).toEqual(["ALTER TABLE `users` DROP COLUMN `name`"]);
  });

  it("MySQL: MODIFY on attribute change, CHANGE on rename", () => {
    const o = orig();
    const modified = edit({ columns: [from(o.columns[0]), from(o.columns[1], { type: "TEXT", nullable: false })] });
    expect(stmts("mysql", o, modified)).toEqual([
      "ALTER TABLE `users` MODIFY COLUMN `name` TEXT NOT NULL",
    ]);
    const renamed = edit({ columns: [from(o.columns[0]), from(o.columns[1], { name: "full_name" })] });
    expect(stmts("mysql", o, renamed)).toEqual([
      "ALTER TABLE `users` CHANGE COLUMN `name` `full_name` VARCHAR(255)",
    ]);
  });

  it("PostgreSQL: attribute-specific ALTER COLUMN (type / nullability / default)", () => {
    const o = orig();
    const e = edit({
      columns: [from(o.columns[0]), from(o.columns[1], { type: "TEXT", nullable: false, defaultValue: "'x'" })],
    });
    expect(stmts("postgres", o, e)).toEqual([
      'ALTER TABLE "users" ALTER COLUMN "name" TYPE TEXT',
      'ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL',
      `ALTER TABLE "users" ALTER COLUMN "name" SET DEFAULT 'x'`,
    ]);
  });

  it("PostgreSQL: rename first, then attribute changes target the new name", () => {
    const o = orig({ columns: [oc("id", "INT", false), oc("name", "TEXT", false, "'a'")] });
    const e = edit({
      columns: [from(o.columns[0]), from(o.columns[1], { name: "label", nullable: true, defaultValue: "" })],
    });
    expect(stmts("postgres", o, e)).toEqual([
      'ALTER TABLE "users" RENAME COLUMN "name" TO "label"',
      'ALTER TABLE "users" ALTER COLUMN "label" DROP NOT NULL',
      'ALTER TABLE "users" ALTER COLUMN "label" DROP DEFAULT',
    ]);
  });

  it("SQLite: can rename a column but not modify it in place", () => {
    const o = orig({ name: "t", columns: [oc("a", "TEXT")] });
    const rename = { name: "t", columns: [from(o.columns[0], { name: "b" })] };
    expect(stmts("sqlite", o, rename)).toEqual(['ALTER TABLE "t" RENAME COLUMN "a" TO "b"']);

    const r = buildAlterTable("sqlite", o, { name: "t", columns: [from(o.columns[0], { type: "INTEGER" })] });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/SQLite no puede modificar/i);
  });

  it("Informix: MODIFY (…) and separate RENAME COLUMN, bare identifiers", () => {
    const o = orig({ name: "t", columns: [oc("a", "INTEGER")] });
    const modify = { name: "t", columns: [from(o.columns[0], { type: "BIGINT", nullable: false })] };
    expect(stmts("informix", o, modify)).toEqual(["ALTER TABLE t MODIFY (a BIGINT NOT NULL)"]);

    const both = { name: "t", columns: [from(o.columns[0], { name: "b", type: "BIGINT" })] };
    expect(stmts("informix", o, both)).toEqual([
      "RENAME COLUMN t.a TO b",
      "ALTER TABLE t MODIFY (b BIGINT)",
    ]);
  });

  it("renames the table last (engine-specific statement)", () => {
    const my = stmts("mysql", orig(), edit({ name: "clientes" }));
    expect(my).toEqual(["ALTER TABLE `users` RENAME TO `clientes`"]);
    // Informix: bare DROP (no COLUMN keyword) then a standalone RENAME TABLE.
    const o = orig({ name: "u" });
    const ifx = stmts("informix", o, { name: "clientes", columns: [from(o.columns[0])] });
    expect(ifx).toEqual(["ALTER TABLE u DROP name", "RENAME TABLE u TO clientes"]);
  });

  it("qualifies with the container database", () => {
    const e = edit({ container: "testdb", columns: [...orig().columns.map((c) => from(c)), added({ name: "x", type: "INT" })] });
    expect(stmts("mysql", orig(), e)[0]).toBe("ALTER TABLE `testdb`.`users` ADD COLUMN `x` INT");
  });

  it("combines add + drop + modify + table rename in order", () => {
    const o = orig();
    const e = edit({
      name: "clientes",
      columns: [
        from(o.columns[0]),
        from(o.columns[1], { type: "TEXT", nullable: false }),
        added({ name: "age", type: "INT" }),
      ],
    });
    // name→TEXT (modify), age added; id kept; nothing dropped; table renamed last.
    expect(stmts("mysql", o, e)).toEqual([
      "ALTER TABLE `users` MODIFY COLUMN `name` TEXT NOT NULL",
      "ALTER TABLE `users` ADD COLUMN `age` INT",
      "ALTER TABLE `users` RENAME TO `clientes`",
    ]);
  });
});

describe("buildAlterTable — validation", () => {
  const bad = (e: AlterTableDef) => {
    const r = buildAlterTable("mysql", orig(), e);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.error;
  };
  it("requires at least one column", () => {
    expect(bad(edit({ columns: [] }))).toMatch(/al menos una columna/i);
  });
  it("rejects duplicate column names", () => {
    expect(bad(edit({ columns: [added({ name: "x" }), added({ name: "X" })] }))).toMatch(/duplicad/i);
  });
  it("requires a table name", () => {
    expect(bad(edit({ name: "  " }))).toMatch(/nombre de la tabla/i);
  });
  it("requires each column to have a type", () => {
    expect(bad(edit({ columns: [added({ name: "x", type: "" })] }))).toMatch(/tipo/i);
  });
});

describe("columnsFromDescribe", () => {
  const rs = (rows: (string | null)[][]): ResultSet => ({
    columns: [
      { name: "name", type: "text" },
      { name: "type", type: "text" },
      { name: "notnull", type: "text" },
      { name: "dflt_value", type: "text" },
      { name: "pk", type: "text" },
    ],
    rows,
    truncated: false,
    rowsAffected: 0,
  });

  it("parses name/type/notnull/default, nullable from notnull", () => {
    const cols = columnsFromDescribe(
      rs([
        ["id", "INT", "1", null, "1"],
        ["name", "VARCHAR(255)", "0", "'—'", "0"],
        ["note", "TEXT", "", null, "0"],
      ]),
    );
    expect(cols).toEqual([
      { name: "id", type: "INT", nullable: false, defaultValue: "" },
      { name: "name", type: "VARCHAR(255)", nullable: true, defaultValue: "'—'" },
      { name: "note", type: "TEXT", nullable: true, defaultValue: "" },
    ]);
  });

  it("skips rows without a name and tolerates missing columns", () => {
    const res: ResultSet = {
      columns: [{ name: "name", type: "text" }],
      rows: [["a"], [null], [""]],
      truncated: false,
      rowsAffected: 0,
    };
    expect(columnsFromDescribe(res)).toEqual([{ name: "a", type: "", nullable: true, defaultValue: "" }]);
  });
});
