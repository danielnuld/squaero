import { describe, it, expect } from "vitest";
import { tablesInStatement } from "../../src/utils/queryTables";

describe("tablesInStatement", () => {
  it("finds the table of a plain select", () => {
    expect(tablesInStatement("SELECT * FROM clientes")).toEqual(["clientes"]);
  });

  it("finds every table of a join, which is the case that matters most", () => {
    // Joins are exactly where remembering column names is hardest, and they are
    // what queryTarget deliberately refuses to answer for.
    expect(
      tablesInStatement(
        "SELECT c.nombre, p.total FROM clientes c JOIN pedidos p ON p.cliente = c.id",
      ),
    ).toEqual(["clientes", "pedidos"]);
  });

  it("handles several joins and a comma list", () => {
    expect(
      tablesInStatement("SELECT * FROM a JOIN b ON 1=1 LEFT JOIN c ON 1=1"),
    ).toEqual(["a", "b", "c"]);
  });

  it("covers the write statements too", () => {
    expect(tablesInStatement("UPDATE clientes SET nombre = 'x'")).toEqual(["clientes"]);
    expect(tablesInStatement("INSERT INTO pedidos (id) VALUES (1)")).toEqual(["pedidos"]);
    expect(tablesInStatement("DELETE FROM viejos WHERE id = 1")).toEqual(["viejos"]);
  });

  it("reduces a qualified name to the segment the tree labels", () => {
    expect(tablesInStatement("SELECT * FROM ventas.public.clientes")).toEqual([
      "clientes",
    ]);
    expect(tablesInStatement("SELECT * FROM jop:informix.enc_test")).toEqual([
      "enc_test",
    ]);
  });

  it("unquotes the engine's own quoting", () => {
    expect(tablesInStatement('SELECT * FROM "mi tabla"')).toEqual(["mi tabla"]);
    expect(tablesInStatement("SELECT * FROM `mi tabla`")).toEqual(["mi tabla"]);
    expect(tablesInStatement("SELECT * FROM [mi tabla]")).toEqual(["mi tabla"]);
  });

  it("ignores what a comment or a string literal says", () => {
    // The shared scrubber earns its keep here: without it these would look like
    // real table references.
    expect(tablesInStatement("SELECT * FROM real -- FROM comentada")).toEqual([
      "real",
    ]);
    expect(tablesInStatement("SELECT 'FROM literal' FROM real")).toEqual(["real"]);
    expect(tablesInStatement("/* FROM bloque */ SELECT * FROM real")).toEqual([
      "real",
    ]);
  });

  it("does not report a subquery as a table", () => {
    expect(tablesInStatement("SELECT * FROM (SELECT 1) t")).toEqual([]);
    expect(
      tablesInStatement("SELECT * FROM clientes WHERE id IN (SELECT id FROM otros)"),
    ).toEqual(["clientes", "otros"]);
  });

  it("reports each table once, in the order first seen", () => {
    expect(
      tablesInStatement("SELECT * FROM a JOIN b ON 1=1 JOIN a AS a2 ON 1=1"),
    ).toEqual(["a", "b"]);
  });

  it("survives empty and nonsense input without throwing", () => {
    expect(tablesInStatement("")).toEqual([]);
    expect(tablesInStatement("SELECT")).toEqual([]);
    expect(tablesInStatement("FROM")).toEqual([]);
    expect(tablesInStatement("FROM FROM")).toEqual([]);
    expect(tablesInStatement("SELECT * FROM WHERE")).toEqual([]);
  });
});
