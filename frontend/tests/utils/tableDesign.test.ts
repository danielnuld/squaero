import { describe, it, expect } from "vitest";
import { buildCreateTable, type TableDef, type ColumnDef } from "../../src/utils/tableDesign";

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
