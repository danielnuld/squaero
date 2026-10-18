import { describe, it, expect } from "vitest";
import {
  editablePk,
  engineEdits,
  queryEditCheck,
  queryEditTarget,
} from "../../src/utils/queryTarget";
import type { ResultSet } from "../../src/utils/query";

describe("queryEditTarget — single-table SELECTs", () => {
  it("reads a bare table", () => {
    expect(queryEditTarget("SELECT * FROM clientes", "mysql")).toEqual({ table: "clientes" });
  });
  it("ignores the WHERE/ORDER/LIMIT tail", () => {
    expect(
      queryEditTarget("select id, nombre from clientes where id = 3 order by id limit 10", "mysql"),
    ).toEqual({ table: "clientes" });
  });
  it("ignores an alias, with or without AS", () => {
    expect(queryEditTarget("SELECT c.* FROM clientes c", "mysql")).toEqual({ table: "clientes" });
    expect(queryEditTarget("SELECT c.* FROM clientes AS c", "mysql")).toEqual({ table: "clientes" });
  });
  it("survives comments, string literals and a trailing semicolon", () => {
    const sql = `-- mi consulta
      SELECT * FROM clientes /* nota */ WHERE nombre = 'from otra join x';`;
    expect(queryEditTarget(sql, "mysql")).toEqual({ table: "clientes" });
  });
  it("accepts the Informix preview's SKIP/FIRST form", () => {
    expect(queryEditTarget("SELECT SKIP 10 FIRST 100 * FROM customer;", "informix")).toEqual({
      table: "customer",
    });
  });
});

describe("queryEditTarget — qualified names", () => {
  it("reads a two-part name as db on MySQL and schema elsewhere", () => {
    expect(queryEditTarget("SELECT * FROM tienda.clientes", "mysql")).toEqual({
      db: "tienda",
      table: "clientes",
    });
    expect(queryEditTarget("SELECT * FROM public.clientes", "postgres")).toEqual({
      schema: "public",
      table: "clientes",
    });
  });
  it("reads a three-part name as db.schema.table", () => {
    expect(queryEditTarget("SELECT * FROM tienda.public.clientes", "postgres")).toEqual({
      db: "tienda",
      schema: "public",
      table: "clientes",
    });
  });
  it("reads the Informix db:owner.table form, dropping the owner", () => {
    // The core reads a `schema` as the DATABASE on Informix: keeping the owner
    // there described (and would have edited) a database called "informix".
    expect(queryEditTarget("SELECT * FROM stores:informix.customer", "informix")).toEqual({
      db: "stores",
      table: "customer",
    });
    expect(queryEditTarget("SELECT * FROM informix.customer", "informix")).toEqual({
      table: "customer",
    });
    expect(queryEditTarget("SELECT * FROM stores:customer", "informix")).toEqual({
      db: "stores",
      table: "customer",
    });
  });
  it("unquotes backticked, double-quoted and bracketed identifiers", () => {
    expect(queryEditTarget("SELECT * FROM `tienda`.`Clientes`", "mysql")).toEqual({
      db: "tienda",
      table: "Clientes",
    });
    expect(queryEditTarget('SELECT * FROM "public"."Clientes"', "postgres")).toEqual({
      schema: "public",
      table: "Clientes",
    });
    expect(queryEditTarget("SELECT * FROM [dbo].[Clientes]", "sqlserver")).toEqual({
      schema: "dbo",
      table: "Clientes",
    });
  });
});

describe("queryEditTarget — refuses anything that is not one table's rows", () => {
  const cases: [string, string][] = [
    ["a join", "SELECT * FROM a JOIN b ON a.id = b.a_id"],
    ["a comma join", "SELECT * FROM a, b"],
    ["a subquery in FROM", "SELECT * FROM (SELECT 1) x"],
    ["DISTINCT", "SELECT DISTINCT nombre FROM clientes"],
    ["GROUP BY", "SELECT pais, COUNT(*) FROM clientes GROUP BY pais"],
    ["a set operation", "SELECT * FROM a UNION SELECT * FROM b"],
    ["a CTE", "WITH x AS (SELECT 1) SELECT * FROM x"],
    ["a non-SELECT statement", "UPDATE clientes SET nombre = 'x'"],
    ["several statements", "SELECT * FROM a; SELECT * FROM b"],
    ["no FROM at all", "SELECT 1"],
  ];
  for (const [what, sql] of cases) {
    it(`refuses ${what}`, () => {
      expect(queryEditTarget(sql, "mysql")).toBeNull();
    });
  }
  it("refuses MongoDB, whose surface is not SQL", () => {
    expect(queryEditTarget("db.clientes.find({})", "mongodb")).toBeNull();
    expect(queryEditTarget("SELECT * FROM clientes", "mongodb")).toBeNull();
  });
  it("refuses empty input", () => {
    expect(queryEditTarget("", "mysql")).toBeNull();
    expect(queryEditTarget("   ", "mysql")).toBeNull();
  });
});

describe("queryEditTarget — name case", () => {
  it("folds unquoted names the way PostgreSQL and Informix store them", () => {
    expect(queryEditTarget("SELECT * FROM Public.Clientes", "postgres")).toEqual({
      schema: "public",
      table: "clientes",
    });
    expect(queryEditTarget("SELECT FIRST 10 * FROM STORES:CUSTOMER", "informix")).toEqual({
      db: "stores",
      table: "customer",
    });
  });
  it("keeps a quoted name exactly as written", () => {
    expect(queryEditTarget('SELECT * FROM "Clientes"', "postgres")).toEqual({ table: "Clientes" });
  });
  it("leaves the case alone where the engine does not fold it", () => {
    expect(queryEditTarget("SELECT * FROM Clientes", "mysql")).toEqual({ table: "Clientes" });
    expect(queryEditTarget("SELECT TOP 10 * FROM dbo.Clientes", "sqlserver")).toEqual({
      schema: "dbo",
      table: "Clientes",
    });
  });
});

describe("queryEditCheck — the reason a result is not editable", () => {
  it("returns the target for a plain single-table SELECT", () => {
    expect(queryEditCheck("SELECT * FROM clientes WHERE id = 1;", "sqlite")).toEqual({
      target: { table: "clientes" },
    });
  });
  it("says statement for anything but one SELECT", () => {
    expect(queryEditCheck("UPDATE clientes SET a = 1", "sqlite")).toEqual({ block: "statement" });
    expect(queryEditCheck("SELECT * FROM a; SELECT * FROM b", "sqlite")).toEqual({
      block: "statement",
    });
    expect(queryEditCheck("", "sqlite")).toEqual({ block: "statement" });
  });
  it("says multiTable for a join, a subquery or a reshaping", () => {
    for (const sql of [
      "SELECT * FROM a JOIN b ON a.id = b.id",
      "SELECT * FROM a, b",
      "SELECT * FROM (SELECT 1) x",
      "SELECT DISTINCT n FROM a",
      "SELECT 1",
    ]) {
      expect(queryEditCheck(sql, "postgres")).toEqual({ block: "multiTable" });
    }
  });
  it("says engine where the driver cannot write rows", () => {
    expect(queryEditCheck("SELECT * FROM clientes", "mssql")).toEqual({ block: "engine" });
    expect(queryEditCheck("db.clientes.find({})", "mongodb")).toEqual({ block: "engine" });
  });
});

describe("engineEdits", () => {
  it("is true for the engines whose driver implements row.*", () => {
    for (const e of ["sqlite", "postgres", "postgresql", "mysql", "mariadb", "informix"]) {
      expect(engineEdits(e)).toBe(true);
    }
  });
  it("is false for the rest, and for no engine", () => {
    for (const e of ["mssql", "sqlserver", "mongodb", ""]) expect(engineEdits(e)).toBe(false);
  });
});

describe("editablePk", () => {
  const describe_ = (rows: [string, string][]): ResultSet => ({
    columns: [
      { name: "name", type: "text" },
      { name: "pk", type: "int" },
    ],
    rows,
    truncated: false,
    rowsAffected: 0,
  });
  const cols = (...names: string[]) => names.map((name) => ({ name, type: "text" }));

  it("returns the key spelled as the result spells it", () => {
    const d = describe_([["id", "1"], ["nombre", "0"]]);
    expect(editablePk(d, cols("id", "nombre"))).toEqual({ pk: ["id"] });
    // MySQL keeps the select list's case: `SELECT ID` comes back as `ID`.
    expect(editablePk(d, cols("ID", "Nombre"))).toEqual({ pk: ["ID"] });
  });
  it("prefers an exact match over a case-insensitive one", () => {
    const d = describe_([["Id", "1"]]);
    expect(editablePk(d, cols("id", "Id"))).toEqual({ pk: ["Id"] });
  });
  it("needs every column of a composite key", () => {
    const d = describe_([["a", "1"], ["b", "2"], ["c", "0"]]);
    expect(editablePk(d, cols("b", "a"))).toEqual({ pk: ["a", "b"] });
    expect(editablePk(d, cols("a", "c"))).toEqual({ block: "pkNotProjected" });
  });
  it("says pkNotProjected when the key is missing or aliased away", () => {
    expect(editablePk(describe_([["id", "1"]]), cols("clave", "nombre"))).toEqual({
      block: "pkNotProjected",
    });
  });
  it("says noPk for a keyless table or a view", () => {
    expect(editablePk(describe_([["id", "0"], ["n", "0"]]), cols("id", "n"))).toEqual({
      block: "noPk",
    });
  });
  it("says noTable when the describe found nothing", () => {
    expect(editablePk(describe_([]), cols("id"))).toEqual({ block: "noTable" });
  });
});
