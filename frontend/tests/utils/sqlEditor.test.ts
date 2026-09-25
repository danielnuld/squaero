import { describe, it, expect } from "vitest";
import {
  completionContext,
  completionItems,
  highlightSql,
  type EditorSchema,
} from "../../src/utils/sqlEditor";

// The iPhone editor's colouring and completion (#578, task 6.1).
const texts = (sql: string, engine?: string) =>
  highlightSql(sql, engine).map((s) => [s.kind, sql.slice(s.start, s.end)]);

describe("highlightSql", () => {
  it("colours keywords, numbers, strings and comments", () => {
    expect(texts("SELECT nombre FROM salas WHERE n > 10 -- fin", "postgres")).toEqual([
      ["keyword", "SELECT"],
      ["keyword", "FROM"],
      ["keyword", "WHERE"],
      ["number", "10"],
      ["comment", "-- fin"],
    ]);
    expect(texts("select 'from' /* where */ , 1.5", "sqlite")).toEqual([
      ["keyword", "select"],
      ["string", "'from'"],
      ["comment", "/* where */"],
      ["number", "1.5"],
    ]);
  });

  it("colours both kinds of variable, but not a cast", () => {
    expect(texts("WHERE sala = :sala AND t = ${tabla} AND x::int = 1", "postgres")).toEqual([
      ["keyword", "WHERE"],
      ["variable", ":sala"],
      ["keyword", "AND"],
      ["variable", "${tabla}"],
      ["keyword", "AND"],
      ["keyword", "int"],
      ["number", "1"],
    ]);
  });

  it("reads double quotes by engine", () => {
    expect(texts('SELECT "from" FROM t', "postgres")[1]).toEqual(["ident", '"from"']);
    expect(texts('SELECT "from" FROM t', "informix")[1]).toEqual(["string", '"from"']);
    expect(texts("SELECT `from` FROM t", "mysql")[1]).toEqual(["ident", "`from`"]);
  });

  it("keeps offsets in UTF-16 units, past accents and emoji", () => {
    const sql = "SELECT 'año 🎉' FROM t";
    const spans = highlightSql(sql, "sqlite");
    expect(sql.slice(spans[2].start, spans[2].end)).toBe("FROM");
  });

  it("gives nothing for an empty text", () => {
    expect(highlightSql("")).toEqual([]);
  });
});

const schema: EditorSchema = {
  tables: ["clientes", "casos", "salas"],
  columns: { clientes: ["id", "nombre", "correo"], casos: ["id", "estado", "cliente_id"] },
};

describe("completionContext", () => {
  it("takes the word before the cursor", () => {
    expect(completionContext("SELECT nom", 10)).toEqual({ from: 7, word: "nom" });
    expect(completionContext("SELECT nom FROM x", 10)).toEqual({ from: 7, word: "nom" });
    expect(completionContext("SELECT ", 7)).toEqual({ from: 7, word: "" });
  });

  it("names the table before a dot, quoted or not", () => {
    expect(completionContext("SELECT c.nom", 12)).toEqual({ from: 9, word: "nom", table: "c" });
    expect(completionContext("SELECT clientes.", 16)).toEqual({ from: 16, word: "", table: "clientes" });
    expect(completionContext('SELECT "Casos".es', 17)).toEqual({ from: 15, word: "es", table: "Casos" });
  });

  it("clamps a cursor out of range", () => {
    expect(completionContext("ab", 99)).toEqual({ from: 0, word: "ab" });
  });
});

describe("completionItems", () => {
  const items = (sql: string) => completionItems(sql, completionContext(sql, sql.length), schema);

  it("offers the columns of the tables in the statement first", () => {
    expect(items("SELECT * FROM casos WHERE es")).toEqual(["estado", "ESCAPED"]);
    expect(items("SELECT c FROM clientes")).toEqual([]); // the cursor is after "clientes"
    expect(completionItems("SELECT c FROM clientes", completionContext("SELECT c", 8), schema)).toEqual([
      "correo",
      "clientes",
      "casos",
      "CASE",
      "CAST",
      "CHECK",
      "COLLATE",
      "COLUMN",
      "COMMIT",
      "CONSTRAINT",
      "CREATE",
      "CROSS",
    ]);
  });

  it("after a dot offers only that table's columns", () => {
    expect(items("SELECT clientes.")).toEqual(["id", "nombre", "correo"]);
    expect(items("SELECT CLIENTES.no")).toEqual(["nombre"]);
    expect(items("SELECT otra.")).toEqual([]);
  });

  it("suggests nothing for an empty word, or a word typed in full", () => {
    expect(items("SELECT ")).toEqual([]);
    expect(items("SELECT * FROM salas")).toEqual([]);
  });

  it("keeps to the limit", () => {
    expect(completionItems("s", { from: 0, word: "s" }, schema, 3)).toHaveLength(3);
  });
});
