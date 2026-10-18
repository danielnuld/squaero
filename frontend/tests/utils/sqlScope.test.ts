import { describe, expect, it } from "vitest";
import {
  analyzeSql,
  lookupRelation,
  scopeAt,
  type Reference,
  type SqlAnalysis,
} from "../../src/utils/sqlScope";

// Semantic scope of the editor's SQL (issue #660): aliases, CTEs, subqueries,
// what each identifier names and what is visible at a cursor.

const schema = {
  tables: ["clientes", "pedidos", "productos"],
  columns: {
    clientes: ["id", "nombre", "ciudad"],
    pedidos: ["id", "cliente_id", "total"],
    productos: ["id", "nombre", "precio"],
  },
};

const analyze = (sql: string, engine?: string) => analyzeSql(sql, { schema, engine });

/** "name:role:resolution" for every reference of the first statement. */
const refs = (a: SqlAnalysis, i = 0) => a.statements[i].references.map((r) => `${r.name}:${r.role}:${r.resolution}`);

/** The reference covering the n-th occurrence of `text` in `sql`. */
function refAt(a: SqlAnalysis, sql: string, text: string, nth = 0): Reference | undefined {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = sql.indexOf(text, at + 1);
  return a.statements.flatMap((s) => s.references).find((r) => r.start <= at && at < r.end);
}

/** Cursor at the "|" of `marked`. */
function at(marked: string, engine?: string) {
  const offset = marked.indexOf("|");
  const sql = marked.replace("|", "");
  return scopeAt(analyzeSql(sql, { schema, engine }), offset)!;
}

describe("analyzeSql — relations and aliases", () => {
  it("resolves a simple select against the schema", () => {
    const a = analyze("SELECT nombre, ciudad FROM clientes WHERE id = 1");
    expect(refs(a)).toEqual([
      "nombre:column:column",
      "ciudad:column:column",
      "clientes:relation:table",
      "id:column:column",
    ]);
  });

  it("declares aliases with AS, without AS, and the bare table name", () => {
    const sql = "SELECT * FROM clientes AS c JOIN pedidos p ON p.cliente_id = c.id, productos";
    const rels = analyze(sql).statements[0].scopes[0].relations;
    expect(rels.map((r) => [r.kind, r.name, r.target])).toEqual([
      ["table", "c", "clientes"],
      ["table", "p", "pedidos"],
      ["table", "productos", "productos"],
    ]);
    expect(rels[0].alias).toEqual({ start: sql.indexOf(" c ") + 1, end: sql.indexOf(" c ") + 2 });
    expect(rels[2].alias).toBeUndefined();
    expect(rels[2].targetRange).toEqual({ start: sql.indexOf("productos"), end: sql.length });
    expect(rels[0].columns).toEqual(["id", "nombre", "ciudad"]);
  });

  it("resolves qualified columns through their alias", () => {
    const sql = "SELECT c.nombre, p.total, p.nope FROM clientes c JOIN pedidos p ON p.cliente_id = c.id";
    const a = analyze(sql);
    const q = refAt(a, sql, "c.nombre")!;
    expect(q).toMatchObject({ role: "qualifier", resolution: "table", name: "c" });
    expect(q.relation!.target).toBe("clientes");
    expect(refAt(a, sql, "nombre")).toMatchObject({ role: "column", resolution: "column" });
    expect(refAt(a, sql, "nope")).toMatchObject({ role: "column", resolution: "unknown" });
  });

  it("flags ambiguous and unknown unqualified columns", () => {
    const sql = "SELECT id, total, zzz FROM clientes c JOIN pedidos p ON p.cliente_id = c.id";
    const a = analyze(sql);
    expect(refAt(a, sql, "id")!.resolution).toBe("ambiguous");
    expect(refAt(a, sql, "total")!.relation!.name).toBe("p");
    expect(refAt(a, sql, "zzz")!.resolution).toBe("unknown");
  });

  it("does not call a USING / NATURAL column ambiguous", () => {
    expect(refs(analyze("SELECT id FROM clientes JOIN productos USING (id)"))[0]).toBe("id:column:column");
    expect(refs(analyze("SELECT nombre FROM clientes NATURAL JOIN productos"))[0]).toBe("nombre:column:column");
  });

  it("resolves an unknown table as unknown, a schema-qualified one by its bare name", () => {
    const a = analyze("SELECT * FROM nadie, public.clientes, otro.esquema_tabla");
    expect(refs(a)).toEqual([
      "nadie:relation:unknown",
      "clientes:relation:table",
      "esquema_tabla:relation:unresolved",
    ]);
    expect(a.statements[0].scopes[0].relations[1].target).toBe("public.clientes");
  });

  it("leaves everything unresolved without a schema, never wrong", () => {
    const a = analyzeSql("SELECT c.x, y FROM clientes c");
    expect(refs(a)).toEqual(["c:qualifier:table", "x:column:unresolved", "y:column:unresolved", "clientes:relation:unresolved"]);
  });

  it("treats an undescribed table's columns as unresolved, not unknown", () => {
    const partial = { tables: ["clientes", "logs"], columns: { clientes: ["id"] } };
    const a = analyzeSql("SELECT msg FROM logs", { schema: partial });
    expect(refs(a)).toEqual(["msg:column:unresolved", "logs:relation:table"]);
  });

  it("matches names case-insensitively", () => {
    const sql = "SELECT C.NOMBRE FROM CLIENTES c";
    expect(refs(analyze(sql))).toEqual(["C:qualifier:table", "NOMBRE:column:column", "CLIENTES:relation:table"]);
  });

  it("reads dialect select modifiers and table hints", () => {
    expect(refs(analyze("SELECT TOP 10 nombre FROM clientes WITH (NOLOCK)", "mssql"))).toEqual([
      "nombre:column:column",
      "clientes:relation:table",
    ]);
    expect(refs(analyze("SELECT FIRST 5 nombre FROM clientes", "informix"))[0]).toBe("nombre:column:column");
    const pg = analyze("SELECT DISTINCT ON (ciudad) ciudad, nombre FROM clientes", "postgres");
    expect(refs(pg).slice(0, 3)).toEqual(["ciudad:column:column", "ciudad:column:column", "nombre:column:column"]);
    const my = analyze("INSERT INTO pedidos (total) VALUES (1) ON DUPLICATE KEY UPDATE total = total + 1", "mysql");
    expect(refs(my)).toEqual([
      "pedidos:relation:table",
      "total:column:column",
      "total:column:column",
      "total:column:column",
    ]);
  });

  it("does not take a reserved word as an alias", () => {
    const rels = analyze("SELECT * FROM clientes WHERE id = 1").statements[0].scopes[0].relations;
    expect(rels[0].alias).toBeUndefined();
    const rels2 = analyze("SELECT * FROM clientes LEFT JOIN pedidos ON 1=1").statements[0].scopes[0].relations;
    expect(rels2.map((r) => r.name)).toEqual(["clientes", "pedidos"]);
  });

  it("ignores identifiers in strings and comments", () => {
    const sql = "SELECT 'FROM pedidos p' AS s -- JOIN productos\nFROM clientes /* x.y */";
    const a = analyze(sql);
    expect(refs(a)).toEqual(["clientes:relation:table"]);
    expect(a.statements[0].scopes[0].columns).toEqual(["s"]);
  });

  it("knows function calls, casts and aliases are not column references", () => {
    const sql = "SELECT count(id) AS n, upper(nombre) nom, id::text FROM clientes ORDER BY n";
    expect(refs(analyze(sql))).toEqual([
      "id:column:column",
      "nombre:column:column",
      "id:column:column",
      "clientes:relation:table",
      "n:column:column",
    ]);
  });
});

describe("analyzeSql — quoted identifiers", () => {
  const quotedSchema = { tables: ["Mis Clientes"], columns: { "Mis Clientes": ["Nombre Completo"] } };

  it.each([
    ["postgres", '"Mis Clientes"', '"Nombre Completo"', '"c"'],
    ["sqlite", '"Mis Clientes"', '"Nombre Completo"', '"c"'],
    ["mysql", "`Mis Clientes`", "`Nombre Completo`", "`c`"],
    ["mssql", "[Mis Clientes]", "[Nombre Completo]", "[c]"],
  ])("%s delimiters", (engine, table, col, alias) => {
    const sql = `SELECT ${alias}.${col} FROM ${table} AS ${alias}`;
    const a = analyzeSql(sql, { schema: quotedSchema, engine });
    expect(refs(a)).toEqual(["c:qualifier:table", "Nombre Completo:column:column", "Mis Clientes:relation:table"]);
    const r = a.statements[0].scopes[0].relations[0];
    expect(r.name).toBe("c");
    // The declaration span covers the delimiters, so a rename replaces them too.
    expect(sql.slice(r.alias!.start, r.alias!.end)).toBe(alias);
  });

  it("reads Informix double quotes as strings, not names", () => {
    const a = analyzeSql('SELECT "nombre" FROM clientes', { schema, engine: "informix" });
    expect(refs(a)).toEqual(["clientes:relation:table"]);
  });
});

describe("analyzeSql — CTEs", () => {
  it("resolves a CTE and its output columns", () => {
    const sql = "WITH grandes AS (SELECT id, total AS monto FROM pedidos WHERE total > 100) SELECT g.monto, id FROM grandes g";
    const a = analyze(sql);
    const st = a.statements[0];
    expect(st.ctes).toHaveLength(1);
    expect(st.ctes[0]).toMatchObject({ name: "grandes", columns: ["id", "monto"], columnsComplete: true, recursive: false });
    expect(st.ctes[0].range.start).toBe(sql.indexOf("grandes"));
    const rel = refAt(a, sql, "grandes", 1)!;
    expect(rel).toMatchObject({ role: "relation", resolution: "cte" });
    expect(rel.cte).toBe(st.ctes[0]);
    expect(refAt(a, sql, "monto", 1)!.resolution).toBe("column");
    expect(refAt(a, sql, "id FROM grandes")!.relation!.kind).toBe("cte");
  });

  it("takes an explicit column list over the body", () => {
    const sql = "WITH x(a, b) AS (SELECT id, nombre FROM clientes) SELECT a, nombre FROM x";
    const a = analyze(sql);
    expect(a.statements[0].ctes[0].columns).toEqual(["a", "b"]);
    expect(refAt(a, sql, "a", 1)!.resolution).toBe("column");
    expect(refAt(a, sql, "nombre", 1)!.resolution).toBe("unknown");
  });

  it("lets later CTEs read earlier ones, and a recursive CTE read itself", () => {
    const sql =
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5), m AS (SELECT i FROM n) SELECT i FROM m";
    const a = analyze(sql);
    const st = a.statements[0];
    expect(st.ctes.map((c) => [c.name, c.recursive])).toEqual([["n", true], ["m", true]]);
    expect(refAt(a, sql, "n", 1)).toMatchObject({ role: "relation", resolution: "cte" });
    expect(refAt(a, sql, "n", 2)).toMatchObject({ role: "relation", resolution: "cte" });
    expect(refAt(a, sql, "m", 1)!.cte!.name).toBe("m");
    expect(st.ctes[1].columns).toEqual(["i"]);
    expect(refs(a).filter((r) => r.startsWith("i:"))).toEqual(Array(4).fill("i:column:column"));
  });

  it("does not let a non-recursive CTE see itself (the name is the real table)", () => {
    const sql = "WITH clientes AS (SELECT id FROM clientes) SELECT id FROM clientes";
    const a = analyze(sql, "postgres");
    expect(refAt(a, sql, "clientes", 1)!.resolution).toBe("table");
    expect(refAt(a, sql, "clientes", 2)!.resolution).toBe("cte");
  });

  it("treats SQL Server CTEs as recursive without the keyword", () => {
    const sql = "WITH n AS (SELECT 1 AS i UNION ALL SELECT i + 1 FROM n) SELECT i FROM n";
    expect(refAt(analyze(sql, "mssql"), sql, "n", 1)!.resolution).toBe("cte");
  });

  it("scopes a CTE to its own query", () => {
    const sql = "SELECT * FROM (WITH t AS (SELECT 1 AS a) SELECT a FROM t) d, t";
    const a = analyze(sql);
    expect(refAt(a, sql, "t", 1)!.resolution).toBe("cte");
    expect(refAt(a, sql, "t", 2)!.resolution).toBe("unknown");
  });
});

describe("analyzeSql — subqueries", () => {
  it("derives a derived table's columns from its select list", () => {
    const sql =
      "SELECT d.nombre, d.n, d.nope FROM (SELECT c.nombre, count(*) AS n FROM clientes c GROUP BY c.nombre) AS d";
    const a = analyze(sql);
    const d = a.statements[0].scopes[0].relations[0];
    expect(d).toMatchObject({ kind: "subquery", name: "d", columns: ["nombre", "n"], columnsComplete: true });
    expect(d.body!.relations[0].name).toBe("c");
    expect(refAt(a, sql, "d.n")!.resolution).toBe("subquery");
    expect(refAt(a, sql, "n,")!.resolution).toBe("column");
    expect(refAt(a, sql, "nope")!.resolution).toBe("unknown");
  });

  it("expands * and t.* from known inner relations", () => {
    const a = analyze("SELECT * FROM (SELECT p.*, c.nombre FROM pedidos p JOIN clientes c ON 1=1) x");
    expect(a.statements[0].scopes[0].relations[0].columns).toEqual(["id", "cliente_id", "total", "nombre"]);
    const b = analyze("SELECT * FROM (SELECT * FROM clientes) x");
    expect(b.statements[0].scopes[0].relations[0].columns).toEqual(["id", "nombre", "ciudad"]);
  });

  it("marks columns incomplete when an item has no derivable name or * is unknown", () => {
    const a = analyze("SELECT x.zzz FROM (SELECT id, id + 1 FROM clientes) x");
    expect(a.statements[0].scopes[0].relations[0]).toMatchObject({ columns: ["id"], columnsComplete: false });
    expect(refs(a)[1]).toBe("zzz:column:unresolved");
    const b = analyze("SELECT * FROM (SELECT * FROM logs) x");
    expect(b.statements[0].scopes[0].relations[0].columns).toBeNull();
  });

  it("uses an alias column list for a derived table and VALUES", () => {
    const a = analyze("SELECT v.a FROM (VALUES (1, 2)) AS v(a, b)");
    expect(a.statements[0].scopes[0].relations[0]).toMatchObject({ kind: "subquery", columns: ["a", "b"] });
    expect(refs(a)).toEqual(["v:qualifier:subquery", "a:column:column"]);
  });

  it("lets a correlated subquery see the outer relations", () => {
    const sql =
      "SELECT c.nombre FROM clientes c WHERE EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id AND total > 0)";
    const a = analyze(sql);
    expect(refAt(a, sql, "c.id")!.relation!.target).toBe("clientes");
    expect(refAt(a, sql, "total")!.relation!.target).toBe("pedidos");
    const inner = a.statements[0].scopes[1];
    expect(inner.correlated).toBe(true);
    expect(inner.parent).toBe(a.statements[0].scopes[0]);
  });

  it("resolves an unqualified column in the innermost level first", () => {
    const sql = "SELECT (SELECT max(id) FROM pedidos) FROM clientes";
    expect(refAt(analyze(sql), sql, "id")!.relation!.target).toBe("pedidos");
  });

  it("does not let a derived table see its siblings, unless LATERAL", () => {
    const sql = "SELECT * FROM clientes c, (SELECT * FROM pedidos WHERE cliente_id = c.id) x";
    expect(refAt(analyze(sql), sql, "c.id")!.resolution).toBe("unknown");
    const lat = "SELECT * FROM clientes c, LATERAL (SELECT * FROM pedidos WHERE cliente_id = c.id) x";
    expect(refAt(analyze(lat), lat, "c.id")!.resolution).toBe("table");
    const apply = "SELECT * FROM clientes c CROSS APPLY (SELECT * FROM pedidos WHERE cliente_id = c.id) x";
    expect(refAt(analyze(apply, "mssql"), apply, "c.id")!.resolution).toBe("table");
  });

  it("gives each UNION branch its own relations", () => {
    const sql = "SELECT nombre FROM clientes UNION SELECT precio FROM productos";
    const a = analyze(sql);
    expect(a.statements[0].scopes).toHaveLength(2);
    expect(refs(a)).toEqual([
      "nombre:column:column",
      "clientes:relation:table",
      "precio:column:column",
      "productos:relation:table",
    ]);
  });
});

describe("analyzeSql — DML targets", () => {
  it("UPDATE: target, alias, SET and WHERE", () => {
    const sql = "UPDATE clientes c SET nombre = 'x', ciudad = c.nombre WHERE c.id = 1";
    const a = analyze(sql);
    expect(a.statements[0].scopes[0].relations[0]).toMatchObject({ name: "c", target: "clientes" });
    expect(refs(a)).toEqual([
      "clientes:relation:table",
      "nombre:column:column",
      "ciudad:column:column",
      "c:qualifier:table",
      "nombre:column:column",
      "c:qualifier:table",
      "id:column:column",
    ]);
  });

  it("UPDATE … FROM: SET's left side belongs to the target", () => {
    const sql = "UPDATE pedidos SET id = c.id FROM clientes c WHERE c.id = pedidos.cliente_id";
    const a = analyze(sql, "postgres");
    expect(refAt(a, sql, "id")!.relation!.target).toBe("pedidos");
    expect(refAt(a, sql, "pedidos.cliente_id")!.resolution).toBe("table");
  });

  it("DELETE: target and WHERE", () => {
    expect(refs(analyze("DELETE FROM pedidos WHERE total < 0"))).toEqual([
      "pedidos:relation:table",
      "total:column:column",
    ]);
  });

  it("INSERT: target, column list and a SELECT on its own level", () => {
    const sql = "INSERT INTO pedidos (cliente_id, total) SELECT id, 0 FROM clientes WHERE ciudad = 'x'";
    const a = analyze(sql);
    expect(refs(a)).toEqual([
      "pedidos:relation:table",
      "cliente_id:column:column",
      "total:column:column",
      "id:column:column",
      "clientes:relation:table",
      "ciudad:column:column",
    ]);
    expect(refAt(a, sql, "id, 0")!.relation!.target).toBe("clientes");
  });

  it("INSERT … VALUES has no table function", () => {
    const a = analyze("INSERT INTO pedidos(total) VALUES (1)");
    expect(a.statements[0].scopes[0].relations[0]).toMatchObject({ kind: "table", target: "pedidos" });
  });

  it("does not model DDL or routine bodies", () => {
    expect(refs(analyze("CREATE TABLE t (id int, nombre text)"))).toEqual([]);
    const a = analyze("CREATE TRIGGER tr AFTER INSERT ON pedidos BEGIN UPDATE clientes SET x = NEW.y; END");
    expect(a.statements).toHaveLength(1);
    expect(refs(a)).toEqual([]);
  });

  it("models the query of a CREATE VIEW", () => {
    expect(refs(analyze("CREATE VIEW v AS SELECT nombre FROM clientes"))).toEqual([
      "nombre:column:column",
      "clientes:relation:table",
    ]);
  });
});

describe("analyzeSql — multiple statements", () => {
  it("analyzes each statement with offsets into the whole document", () => {
    const sql = "SELECT id FROM clientes;\nSELECT p.total FROM pedidos p";
    const a = analyze(sql);
    expect(a.statements).toHaveLength(2);
    const r = a.statements[1].references.find((x) => x.name === "total")!;
    expect(sql.slice(r.start, r.end)).toBe("total");
    expect(r.relation!.target).toBe("pedidos");
  });
});

describe("analyzeSql — incomplete SQL", () => {
  it("survives every prefix of a complex query without throwing", () => {
    const sql =
      "WITH RECURSIVE x(a) AS (SELECT 1 UNION SELECT a + 1 FROM x) SELECT c.nombre, (SELECT max(total) FROM pedidos p " +
      "WHERE p.cliente_id = c.id) AS m, d.* FROM clientes AS c LEFT JOIN (SELECT * FROM productos) d ON d.id = c.id, " +
      "LATERAL f(c.id) g WHERE c.ciudad IN ('a', \"b\") GROUP BY 1 ORDER BY m DESC; UPDATE t SET a = 1";
    for (let i = 0; i <= sql.length; i++) {
      for (const engine of ["postgres", "mysql", "mssql", "informix", "sqlite"]) {
        const a = analyzeSql(sql.slice(0, i), { schema, engine });
        expect(() => scopeAt(a, i)).not.toThrow();
      }
    }
  });

  it("survives garbage", () => {
    for (const s of [")))", "((((", "SELECT ,,, FROM ,", "FROM", "JOIN ON", "WITH", "WITH x AS", ". . .", "SELECT a. FROM"]) {
      expect(() => analyze(s)).not.toThrow();
    }
  });

  it("still resolves what it can around an unclosed paren", () => {
    const sql = "SELECT c.nombre FROM clientes c WHERE c.id IN (SELECT cliente_id FROM pedidos WHERE ";
    const a = analyze(sql);
    expect(refAt(a, sql, "c.nombre")!.resolution).toBe("table");
    expect(refAt(a, sql, "cliente_id")!.resolution).toBe("column");
  });

  it("handles a trailing JOIN and a missing FROM", () => {
    const a = analyze("SELECT * FROM clientes c JOIN ");
    expect(a.statements[0].scopes[0].relations.map((r) => r.name)).toEqual(["c"]);
    expect(refs(analyze("SELECT nombre"))).toEqual(["nombre:column:unresolved"]);
  });

  it("reads `alias.` with nothing after as a qualifier, even before FROM", () => {
    const sql = "SELECT c. FROM clientes c";
    const a = analyze(sql);
    expect(refs(a)).toEqual(["c:qualifier:table", "clientes:relation:table"]);
    expect(analyze("SELECT c.\nFROM clientes c").statements[0].scopes[0].relations).toHaveLength(1);
  });

  it("keeps a reserved word glued to the dot as a column", () => {
    const a = analyzeSql("SELECT t.order FROM t", { schema: { tables: ["t"], columns: { t: ["order"] } } });
    expect(refs(a)).toEqual(["t:qualifier:table", "order:column:column", "t:relation:table"]);
  });
});

describe("scopeAt", () => {
  it("returns the clause at the cursor", () => {
    expect(at("SELECT | FROM clientes").clause).toBe("select");
    expect(at("SELECT * FROM |").clause).toBe("from");
    expect(at("SELECT * FROM clientes c JOIN |").clause).toBe("join");
    expect(at("SELECT * FROM clientes c JOIN pedidos p ON |").clause).toBe("on");
    expect(at("SELECT * FROM clientes WHERE |").clause).toBe("where");
    expect(at("SELECT * FROM clientes GROUP BY |").clause).toBe("group-by");
    expect(at("SELECT * FROM clientes ORDER BY |").clause).toBe("order-by");
    expect(at("UPDATE clientes SET |").clause).toBe("set");
    expect(at("INSERT INTO |").clause).toBe("into");
    expect(at("WITH |").clause).toBe("with");
    expect(at("|SELECT 1").clause).toBe("other");
  });

  it("lists the relations and columns visible at the cursor", () => {
    const s = at("SELECT | FROM clientes c JOIN pedidos p ON 1=1");
    expect(s.relations.map((r) => r.name)).toEqual(["c", "p"]);
    expect(s.columns.filter((c) => c.name === "id").map((c) => c.relation.name)).toEqual(["c", "p"]);
    expect(lookupRelation(s.scope, "P")!.target).toBe("pedidos");
  });

  it("inside a subquery sees its own FROM plus the outer one when correlated", () => {
    const s = at("SELECT * FROM clientes c WHERE EXISTS (SELECT 1 FROM pedidos p WHERE |)");
    expect(s.clause).toBe("where");
    expect(s.relations.map((r) => r.name)).toEqual(["p", "c"]);
    const d = at("SELECT * FROM clientes c, (SELECT | FROM pedidos p) x");
    expect(d.relations.map((r) => r.name)).toEqual(["p"]);
  });

  it("knows the clause of an outer query after a subquery closes", () => {
    expect(at("SELECT * FROM (SELECT 1) x WHERE |").clause).toBe("where");
  });

  it("offers the CTEs visible at the cursor", () => {
    expect(at("WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM |").ctes.map((c) => c.name)).toEqual(["a", "b"]);
    expect(at("WITH a AS (SELECT * FROM |), b AS (SELECT 2) SELECT 1").ctes).toEqual([]);
  });

  it("picks the statement under the cursor", () => {
    const s = at("SELECT * FROM clientes; SELECT * FROM pedidos p WHERE p.|");
    expect(s.relations.map((r) => r.target)).toEqual(["pedidos"]);
    expect(s.clause).toBe("where");
  });

  it("returns columns of a CTE or derived table through its alias", () => {
    const s = at("WITH g AS (SELECT id AS k FROM pedidos) SELECT g.| FROM g");
    expect(lookupRelation(s.scope, "g")!.columns).toEqual(["k"]);
  });

  it("returns null outside any statement", () => {
    expect(scopeAt(analyzeSql(""), 5)).toBeNull();
  });
});
