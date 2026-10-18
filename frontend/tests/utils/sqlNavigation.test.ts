import { describe, expect, it } from "vitest";
import { analyzeSql } from "../../src/utils/sqlScope";
import {
  definitionAt,
  objectNodeFor,
  occurrencesOf,
  renameEdits,
  routineAt,
  symbolAt,
  symbolName,
} from "../../src/utils/sqlNavigation";

// Go to definition / find usages (#663) and rename (#664) over sqlScope.

const schema = {
  tables: ["clientes", "pedidos"],
  columns: {
    clientes: ["id", "nombre"],
    pedidos: ["id", "cliente_id", "total"],
  },
};

/** The text without its "|" cursor marker, and the marker's offset. */
function cursor(marked: string) {
  return { sql: marked.replace("|", ""), offset: marked.indexOf("|") };
}

const analyze = (sql: string, engine?: string) => analyzeSql(sql, { schema, engine });

function definition(marked: string, engine?: string) {
  const { sql, offset } = cursor(marked);
  const d = definitionAt(analyze(sql, engine), offset);
  if (!d) return null;
  return d.kind === "range" ? { at: d.range.start, text: sql.slice(d.range.start, d.range.end) } : d;
}

/** The text of each occurrence of the symbol under the cursor, with its offset. */
function usages(marked: string, engine?: string) {
  const { sql, offset } = cursor(marked);
  const a = analyze(sql, engine);
  const sym = symbolAt(a, offset);
  return sym ? occurrencesOf(a, sym).map((r) => `${r.start}:${sql.slice(r.start, r.end)}`) : null;
}

/** The script after renaming the symbol under the cursor, or the error. */
function rename(marked: string, newName: string, engine?: string): string {
  const { sql, offset } = cursor(marked);
  const res = renameEdits(sql, analyze(sql, engine), offset, newName, engine);
  if ("error" in res) return `error:${res.error}`;
  let out = sql;
  for (const c of [...res.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

describe("definitionAt", () => {
  it("leads an alias qualifier to its declaration", () => {
    const sql = "SELECT |c.nombre FROM clientes c";
    expect(definition(sql)).toEqual({ at: 30, text: "c" });
  });

  it("leads a CTE reference to its name in WITH", () => {
    expect(definition("WITH t AS (SELECT 1 AS x) SELECT x FROM |t")).toEqual({ at: 5, text: "t" });
  });

  it("leads a table to the database object", () => {
    expect(definition("SELECT * FROM |clientes")).toEqual({ kind: "object", name: "clientes" });
    expect(definition("SELECT * FROM public.|clientes")).toEqual({ kind: "object", name: "public.clientes" });
  });

  it("leads an unaliased table qualifier and a column to the table", () => {
    expect(definition("SELECT |clientes.id FROM clientes")).toEqual({ kind: "object", name: "clientes" });
    expect(definition("SELECT c.|nombre FROM clientes c")).toEqual({ kind: "object", name: "clientes" });
  });

  it("leads a subquery alias to its declaration", () => {
    const sql = "SELECT |s.x FROM (SELECT 1 AS x) s";
    expect(definition(sql)).toEqual({ at: 32, text: "s" });
  });

  it("is null on a keyword, a string or a comment", () => {
    expect(definition("|SELECT 1")).toBeNull();
    expect(definition("SELECT 'c|.x' FROM clientes c")).toBeNull();
    expect(definition("SELECT 1 -- c|.x\nFROM clientes c")).toBeNull();
  });

  it("is null on an unknown qualifier", () => {
    expect(definition("SELECT |z.id FROM clientes c")).toBeNull();
  });
});

describe("occurrencesOf", () => {
  it("lists an alias's declaration and its qualifiers, from the declaration", () => {
    expect(usages("SELECT c.id, c.nombre FROM clientes |c WHERE c.id = 1")).toEqual([
      "7:c", "13:c", "36:c", "44:c",
    ]);
  });

  it("does not mix the same alias of another statement", () => {
    expect(usages("SELECT |c.id FROM clientes c; SELECT c.id FROM pedidos c")).toEqual(["7:c", "26:c"]);
  });

  it("does not mix a sibling subquery's alias", () => {
    const sql = "SELECT * FROM (SELECT |x.id FROM clientes x) a, (SELECT x.id FROM pedidos x) b";
    expect(usages(sql)).toEqual(["22:x", "41:x"]);
  });

  it("lists a table in every statement, aliased or not", () => {
    expect(usages("SELECT * FROM |clientes c; SELECT clientes.id FROM clientes")).toEqual([
      "14:clientes", "33:clientes", "50:clientes",
    ]);
  });

  it("keeps tables of different schemas apart", () => {
    expect(usages("SELECT * FROM a.|t; SELECT * FROM b.t; SELECT * FROM t")).toEqual(["16:t", "52:t"]);
  });

  it("lists a column across statements", () => {
    expect(usages("SELECT |nombre FROM clientes; SELECT c.nombre FROM clientes c")).toEqual([
      "7:nombre", "38:nombre",
    ]);
  });

  it("is null where there is no symbol", () => {
    expect(usages("SEL|ECT 1")).toBeNull();
  });
});

describe("renameEdits: aliases", () => {
  it("renames the declaration and every qualifier", () => {
    expect(rename("SELECT c.id FROM clientes |c WHERE c.nombre = 'c.x'", "cli")).toBe(
      "SELECT cli.id FROM clientes cli WHERE cli.nombre = 'c.x'",
    );
  });

  it("leaves the same alias of another statement alone", () => {
    expect(rename("SELECT |c.id FROM clientes c; SELECT c.id FROM pedidos c", "k")).toBe(
      "SELECT k.id FROM clientes k; SELECT c.id FROM pedidos c",
    );
  });

  it("respects a nested subquery that shadows the alias", () => {
    const sql = "SELECT |c.id FROM clientes c WHERE EXISTS (SELECT 1 FROM pedidos c WHERE c.id = 1)";
    expect(rename(sql, "k")).toBe(
      "SELECT k.id FROM clientes k WHERE EXISTS (SELECT 1 FROM pedidos c WHERE c.id = 1)",
    );
  });

  it("reaches a correlated subquery's references to the outer alias", () => {
    const sql = "SELECT 1 FROM clientes |c WHERE EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id)";
    expect(rename(sql, "k")).toBe(
      "SELECT 1 FROM clientes k WHERE EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = k.id)",
    );
  });

  it("does not touch comments", () => {
    expect(rename("SELECT c.id /* c.id */ FROM clientes |c -- c\n", "k")).toBe(
      "SELECT k.id /* c.id */ FROM clientes k -- c\n",
    );
  });

  it("refuses a name another relation of the FROM already has", () => {
    expect(rename("SELECT 1 FROM clientes |c, pedidos p", "P")).toBe("error:conflict");
  });
});

describe("renameEdits: CTEs", () => {
  it("renames the CTE, its references and its unaliased qualifiers", () => {
    const sql = "WITH |t AS (SELECT 1 AS x) SELECT t.x FROM t JOIN t u ON u.x = t.x";
    expect(rename(sql, "base")).toBe(
      "WITH base AS (SELECT 1 AS x) SELECT base.x FROM base JOIN base u ON u.x = base.x",
    );
  });

  it("renames a recursive CTE's self-reference", () => {
    const sql = "WITH RECURSIVE n AS (SELECT 1 AS i UNION ALL SELECT i + 1 FROM n WHERE i < 5) SELECT i FROM |n";
    expect(rename(sql, "seq")).toBe(
      "WITH RECURSIVE seq AS (SELECT 1 AS i UNION ALL SELECT i + 1 FROM seq WHERE i < 5) SELECT i FROM seq",
    );
  });

  it("refuses the name of a sibling CTE", () => {
    expect(rename("WITH |a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b", "B")).toBe("error:conflict");
  });
});

describe("renameEdits: tables and columns", () => {
  it("renames a table across statements and its unaliased qualifiers", () => {
    expect(rename("SELECT clientes.id FROM |clientes; DELETE FROM clientes", "customers")).toBe(
      "SELECT customers.id FROM customers; DELETE FROM customers",
    );
  });

  it("renames a qualified column of a table", () => {
    expect(rename("SELECT c.|nombre FROM clientes c WHERE c.nombre <> ''", "name")).toBe(
      "SELECT c.name FROM clientes c WHERE c.name <> ''",
    );
  });
});

describe("renameEdits: quoting", () => {
  it("quotes a name that cannot stand bare, per engine", () => {
    expect(rename("SELECT c.id FROM clientes |c", "my alias", "postgres")).toBe(
      'SELECT "my alias".id FROM clientes "my alias"',
    );
    expect(rename("SELECT c.id FROM clientes |c", "order", "mysql")).toBe(
      "SELECT `order`.id FROM clientes `order`",
    );
    expect(rename("SELECT c.id FROM clientes |c", "a b", "mssql")).toBe(
      "SELECT [a b].id FROM clientes [a b]",
    );
    expect(rename("SELECT c.id FROM clientes |c", "Cli", "postgres")).toBe('SELECT "Cli".id FROM clientes "Cli"');
  });

  it("keeps an occurrence quoted when it was", () => {
    expect(rename('SELECT "c".id FROM clientes |c', "k", "postgres")).toBe('SELECT "k".id FROM clientes k');
  });

  it("renames a quoted identifier, delimiters included", () => {
    expect(rename('SELECT x.id FROM clientes |"x"', "y", "postgres")).toBe('SELECT y.id FROM clientes "y"');
  });

  it("refuses a name Informix could only write delimited", () => {
    expect(rename("SELECT c.id FROM clientes |c", "a b", "informix")).toBe("error:needs-quotes");
  });
});

describe("renameEdits: invalid input", () => {
  it("refuses an empty or multi-line name", () => {
    expect(rename("SELECT c.id FROM clientes |c", "  ")).toBe("error:empty");
    expect(rename("SELECT c.id FROM clientes |c", "a\nb")).toBe("error:invalid");
  });

  it("refuses where there is nothing to rename", () => {
    expect(rename("SEL|ECT 1", "x")).toBe("error:no-symbol");
    expect(rename("SELECT '|c'", "x")).toBe("error:no-symbol");
  });
});

describe("symbolName", () => {
  it("names each kind of symbol", () => {
    const { sql } = cursor("WITH t AS (SELECT 1) SELECT c.nombre FROM s.clientes c, t");
    const a = analyze(sql);
    const name = (text: string) => symbolName(symbolAt(a, sql.indexOf(text))!);
    expect(name("t AS")).toBe("t");
    expect(name("c.nombre")).toBe("c");
    expect(name("nombre")).toBe("nombre");
    expect(name("clientes")).toBe("clientes");
  });
});

describe("routineAt", () => {
  it("finds a call, schema-qualified or not", () => {
    expect(routineAt("SELECT total_de(1)", 9)).toEqual({ name: "total_de", schema: undefined });
    expect(routineAt("SELECT ventas.total_de(1)", 8)).toEqual({ name: "total_de", schema: "ventas" });
    expect(routineAt("CALL recalcular()", 7)).toEqual({ name: "recalcular", schema: undefined });
  });

  it("ignores names not followed by a parenthesis, keywords and table definitions", () => {
    expect(routineAt("SELECT total_de FROM t", 9)).toBeNull();
    expect(routineAt("SELECT * FROM t WHERE x IN (1)", 25)).toBeNull();
    expect(routineAt("CREATE TABLE t (id int)", 13)).toBeNull();
    expect(routineAt("SELECT 'f(1)'", 9)).toBeNull();
  });
});

describe("objectNodeFor", () => {
  const nodes = [
    { kind: "database", label: "clientes" },
    { kind: "table", label: "Clientes", schema: "ventas" },
    { kind: "view", label: "resumen", db: "main" },
  ];

  it("finds a table or view by name, any case", () => {
    expect(objectNodeFor(nodes, "clientes")).toBe(nodes[1]);
    expect(objectNodeFor(nodes, "RESUMEN")).toBe(nodes[2]);
  });

  it("requires a qualifier to match the schema or database", () => {
    expect(objectNodeFor(nodes, "ventas.clientes")).toBe(nodes[1]);
    expect(objectNodeFor(nodes, "main.resumen")).toBe(nodes[2]);
    expect(objectNodeFor(nodes, "otro.clientes")).toBeUndefined();
  });

  it("is undefined for what the tree has not loaded", () => {
    expect(objectNodeFor(nodes, "pedidos")).toBeUndefined();
  });
});
