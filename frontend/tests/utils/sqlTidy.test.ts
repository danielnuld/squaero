import { describe, it, expect } from "vitest";
import {
  tidySql,
  unquoteIdentifiers,
  collapseDoubleParens,
  canGoBare,
  identifierQuote,
  scanSql,
} from "../../src/utils/sqlTidy";

// This rewrites the user's SQL, so the tests care less about what it tidies than
// about what it refuses to touch (issue #409).

describe("identifierQuote", () => {
  it("knows what each engine delimits with", () => {
    expect(identifierQuote("mysql")).toBe("`");
    expect(identifierQuote("mariadb")).toBe("`");
    expect(identifierQuote("postgres")).toBe('"');
    expect(identifierQuote("sqlite")).toBe('"');
  });

  it("leaves alone the engines with nothing to strip", () => {
    // Informix rejects delimited identifiers; MongoDB is not SQL.
    expect(identifierQuote("informix")).toBeNull();
    expect(identifierQuote("mongodb")).toBeNull();
    expect(identifierQuote(undefined)).toBeNull();
    expect(identifierQuote("some-future-engine")).toBeNull();
  });
});

describe("canGoBare", () => {
  it("accepts a plain name", () => {
    expect(canGoBare("id", "mysql")).toBe(true);
    expect(canGoBare("cliente_id", "mysql")).toBe(true);
    expect(canGoBare("_x9", "mysql")).toBe(true);
  });

  it("refuses anything that is not one plain word", () => {
    expect(canGoBare("mi tabla", "mysql")).toBe(false);
    expect(canGoBare("año", "mysql")).toBe(false);
    expect(canGoBare("9lives", "mysql")).toBe(false);
    expect(canGoBare("a-b", "mysql")).toBe(false);
    expect(canGoBare("", "mysql")).toBe(false);
  });

  it("refuses a word reserved in any engine we support", () => {
    for (const w of ["select", "order", "group", "key", "table", "user", "from"]) {
      expect(canGoBare(w, "mysql")).toBe(false);
    }
    // Reserved in one engine keeps its quotes in all of them: over-quoting is
    // free, under-quoting breaks the statement.
    expect(canGoBare("analyse", "mysql")).toBe(false); // PostgreSQL's
    expect(canGoBare("vacuum", "mysql")).toBe(false); // SQLite's
  });

  it("refuses a type name, which bare would parse as a type", () => {
    expect(canGoBare("int", "postgres")).toBe(false);
    expect(canGoBare("text", "postgres")).toBe(false);
    expect(canGoBare("timestamp", "mysql")).toBe(false);
  });

  it("case matters only where unquoting would fold it", () => {
    // PostgreSQL lower-cases an undelimited name: "Clientes" and Clientes are
    // different objects, so the quotes stay.
    expect(canGoBare("Clientes", "postgres")).toBe(false);
    expect(canGoBare("clientes", "postgres")).toBe(true);
    // MySQL and SQLite compare case-insensitively and the letters do not change.
    expect(canGoBare("LG_Documento", "mysql")).toBe(true);
    expect(canGoBare("LG_Documento", "sqlite")).toBe(true);
  });
});

describe("scanSql", () => {
  it("tells an identifier from a string that looks like one", () => {
    const sql = "SELECT `a` FROM t WHERE s = 'has `a` inside'";
    const kinds = scanSql(sql, "`").map((s) => s.kind);
    expect(kinds).toContain("ident");
    expect(kinds).toContain("string");
  });

  it("reads a doubled delimiter as one character, not as a close", () => {
    const spans = scanSql("SELECT `we``ird` FROM t", "`");
    const ident = spans.find((s) => s.kind === "ident")!;
    expect("SELECT `we``ird` FROM t".slice(ident.start, ident.end)).toBe("`we``ird`");
  });
});

describe("unquoteIdentifiers", () => {
  it("strips the delimiters a name does not need", () => {
    expect(unquoteIdentifiers("SELECT `id`, `total` FROM `pedidos`", "mysql")).toBe(
      "SELECT id, total FROM pedidos",
    );
    expect(unquoteIdentifiers('SELECT "id" FROM "pedidos"', "postgres")).toBe(
      "SELECT id FROM pedidos",
    );
  });

  it("keeps them where they carry meaning", () => {
    expect(unquoteIdentifiers("SELECT `order`, `mi campo` FROM `t`", "mysql")).toBe(
      "SELECT `order`, `mi campo` FROM t",
    );
    expect(unquoteIdentifiers('SELECT "Clientes" FROM t', "postgres")).toBe(
      'SELECT "Clientes" FROM t',
    );
  });

  it("never touches the inside of a string or a comment", () => {
    const sql = "SELECT '`id`' AS a, `id` -- `id` in a comment\nFROM t";
    expect(unquoteIdentifiers(sql, "mysql")).toBe(
      "SELECT '`id`' AS a, id -- `id` in a comment\nFROM t",
    );
  });

  it("a double quote is a string on MySQL and an identifier elsewhere", () => {
    // On MySQL "id" is the three-character value, not a column: leave it.
    expect(unquoteIdentifiers('SELECT "id" FROM t', "mysql")).toBe('SELECT "id" FROM t');
    expect(unquoteIdentifiers('SELECT "id" FROM t', "sqlite")).toBe("SELECT id FROM t");
  });

  it("leaves Informix and MongoDB alone entirely", () => {
    expect(unquoteIdentifiers("SELECT `id` FROM t", "informix")).toBe("SELECT `id` FROM t");
    expect(unquoteIdentifiers("db.c.find({})", "mongodb")).toBe("db.c.find({})");
  });

  it("survives an unterminated delimiter without losing text", () => {
    const sql = "SELECT `id FROM t";
    expect(unquoteIdentifiers(sql, "mysql")).toBe(sql);
  });
});

describe("collapseDoubleParens", () => {
  it("drops the outer of a doubled pair", () => {
    expect(collapseDoubleParens("ON ((a = b))", "mysql")).toBe("ON (a = b)");
    expect(collapseDoubleParens("WHERE (((x)))", "mysql")).toBe("WHERE (x)");
  });

  it("never unwraps a call's parenthesis", () => {
    // One row-valued argument is not two arguments.
    expect(collapseDoubleParens("SELECT f((a, b))", "mysql")).toBe("SELECT f((a, b))");
    expect(collapseDoubleParens("SELECT sum((a + b))", "mysql")).toBe("SELECT sum((a + b))");
  });

  it("leaves a pair that wraps more than another pair", () => {
    expect(collapseDoubleParens("WHERE (a = 1)", "mysql")).toBe("WHERE (a = 1)");
    expect(collapseDoubleParens("IN ((1, 2), (3, 4))", "mysql")).toBe("IN ((1, 2), (3, 4))");
    expect(collapseDoubleParens("WHERE ((a) AND (b))", "mysql")).toBe("WHERE ((a) AND (b))");
  });

  it("ignores parentheses inside strings and comments", () => {
    expect(collapseDoubleParens("SELECT '((x))' FROM t", "mysql")).toBe("SELECT '((x))' FROM t");
    expect(collapseDoubleParens("-- ((x))\nSELECT 1", "mysql")).toBe("-- ((x))\nSELECT 1");
  });

  it("keeps a subquery's own parenthesis", () => {
    expect(collapseDoubleParens("WHERE id IN ((SELECT id FROM t))", "mysql")).toBe(
      "WHERE id IN (SELECT id FROM t)",
    );
  });
});

describe("tidySql on what MySQL actually returns", () => {
  it("makes a normalized view definition readable without changing it", () => {
    const stored =
      "select `c`.`id` AS `id`,`c`.`nombre` AS `nombre`,sum(`p`.`total`) AS `total` " +
      "from (`clientes` `c` join `pedidos` `p` on((`p`.`cliente_id` = `c`.`id`))) " +
      "where (`c`.`activo` = 1) group by `c`.`id`";
    expect(tidySql(stored, "mysql")).toBe(
      "select c.id AS id,c.nombre AS nombre,sum(p.total) AS total " +
        // `on((…))` loses a layer; `sum((…))` would not, and `where (…)` keeps
        // its single pair — deciding that one is redundant needs precedence.
        "from (clientes c join pedidos p on(p.cliente_id = c.id)) " +
        "where (c.activo = 1) group by c.id",
    );
  });

  it("is idempotent", () => {
    const once = tidySql("SELECT `a` FROM ((`t`))", "mysql");
    expect(tidySql(once, "mysql")).toBe(once);
  });

  it("leaves a query that needs no tidying byte for byte", () => {
    const sql = "SELECT a, b FROM t WHERE a = 1 ORDER BY b";
    expect(tidySql(sql, "mysql")).toBe(sql);
  });
});

// A reserved word is not necessarily uncallable, and that is where a denylist of
// function names would have gone wrong.
describe("the parenthesis allowlist", () => {
  it("keeps the pair after a keyword that is also a function", () => {
    for (const fn of ["left", "right", "if", "char", "replace", "convert", "mod", "values"]) {
      const sql = `SELECT ${fn}((a))`;
      expect(collapseDoubleParens(sql, "mysql")).toBe(sql);
    }
  });

  it("collapses after a keyword that can only group", () => {
    expect(collapseDoubleParens("WHERE NOT ((a))", "mysql")).toBe("WHERE NOT ((a))");
    expect(collapseDoubleParens("AND ((a = b))", "mysql")).toBe("AND (a = b)");
    expect(collapseDoubleParens("ORDER BY ((a))", "mysql")).toBe("ORDER BY (a)");
  });

  it("collapses after punctuation and at the start", () => {
    expect(collapseDoubleParens("((a))", "mysql")).toBe("(a)");
    expect(collapseDoubleParens("SELECT 1, ((a))", "mysql")).toBe("SELECT 1, (a)");
    expect(collapseDoubleParens("SELECT a = ((b))", "mysql")).toBe("SELECT a = (b)");
  });

  it("does not read a word across a string boundary", () => {
    // The word before the paren must be code; 'sum' here is a value.
    const sql = "SELECT 'sum' ((a))";
    expect(collapseDoubleParens(sql, "mysql")).toBe(sql);
  });
});
