import { describe, it, expect } from "vitest";
import { queryEditTarget } from "../../src/utils/queryTarget";

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
  it("reads the Informix db:owner.table form", () => {
    expect(queryEditTarget("SELECT * FROM stores:informix.customer", "informix")).toEqual({
      db: "stores",
      schema: "informix",
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
