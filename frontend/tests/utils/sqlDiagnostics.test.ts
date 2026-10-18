import { describe, expect, it } from "vitest";
import {
  ambiguousColumns,
  insertArity,
  sqlDiagnostics,
  unfilteredWrites,
  unknownColumns,
  unknownTables,
  type DiagnoseOptions,
} from "../../src/utils/sqlDiagnostics";
import { analyzeSql } from "../../src/utils/sqlScope";
import { tokenizeSql } from "../../src/utils/sqlTokens";
import type { EditorSchema } from "../../src/utils/sqlEditor";

// Editor diagnostics (issue #662): each rule nominal, edge and not applicable,
// and silence whenever the schema needed to be sure is not loaded.

const schema: EditorSchema = {
  tables: ["clientes", "pedidos"],
  columns: {
    clientes: ["id", "nombre"],
    pedidos: ["id", "cliente_id", "total"],
  },
};

const a = (sql: string, s: EditorSchema | null = schema) => analyzeSql(sql, { schema: s });
const t = (sql: string) => tokenizeSql(sql);
/** The flagged text of each diagnostic. */
const marked = (sql: string, ds: { from: number; to: number }[]) => ds.map((d) => sql.slice(d.from, d.to));
const all = (sql: string, opts: DiagnoseOptions = {}) => sqlDiagnostics(sql, { schema, ...opts });

describe("unknownTables", () => {
  it("flags a table the loaded schema does not have", () => {
    const sql = "SELECT * FROM clientez";
    const d = unknownTables(a(sql), t(sql));
    expect(marked(sql, d)).toEqual(["clientez"]);
    expect(d[0]).toMatchObject({ severity: "error", messageKey: "diag.unknownTable", params: { name: "clientez" } });
  });

  it("needs the table confirmed missing when the editor says which are", () => {
    const sql = "SELECT * FROM clientez JOIN otra ON 1=1";
    expect(marked(sql, unknownTables(a(sql), t(sql), new Set(["otra"])))).toEqual(["otra"]);
  });

  it("is silent without a schema or with an empty table list", () => {
    const sql = "SELECT * FROM clientez";
    expect(unknownTables(a(sql, null), t(sql))).toEqual([]);
    expect(unknownTables(a(sql, { tables: [], columns: {} }), t(sql))).toEqual([]);
  });

  it("does not flag CTEs, schema-qualified names or tables the script creates", () => {
    const sql =
      "CREATE TEMP TABLE IF NOT EXISTS tmp (x int); WITH c AS (SELECT 1) SELECT * FROM c, otro.tabla, tmp";
    expect(unknownTables(a(sql), t(sql))).toEqual([]);
  });
});

describe("unknownColumns", () => {
  it("flags a column the table does not have, qualified or not", () => {
    const sql = "SELECT nombr, c.idd FROM clientes c";
    expect(marked(sql, unknownColumns(a(sql)))).toEqual(["nombr", "idd"]);
  });

  it("is silent when the relation's columns are not known", () => {
    const sql = "SELECT foo FROM clientes c JOIN otra o ON o.bar = c.id";
    expect(unknownColumns(a(sql, { tables: ["clientes", "otra"], columns: { clientes: ["id"] } }))).toEqual([]);
  });

  it("accepts select aliases in ORDER BY and row identifiers", () => {
    const sql = "SELECT nombre AS n, rowid FROM clientes ORDER BY n";
    expect(unknownColumns(a(sql))).toEqual([]);
  });

  it("is silent without a schema", () => {
    expect(unknownColumns(a("SELECT x FROM clientes", null))).toEqual([]);
  });
});

describe("ambiguousColumns", () => {
  it("flags a column two joined tables have, naming them", () => {
    const sql = "SELECT id FROM clientes c JOIN pedidos p ON p.cliente_id = c.id";
    const d = ambiguousColumns(a(sql));
    expect(marked(sql, d)).toEqual(["id"]);
    expect(d[0].params).toMatchObject({ tables: "c, p" });
  });

  it("does not flag a qualified or USING-merged column", () => {
    expect(ambiguousColumns(a("SELECT c.id FROM clientes c JOIN pedidos p ON 1=1"))).toEqual([]);
    expect(ambiguousColumns(a("SELECT id FROM clientes JOIN pedidos USING (id)"))).toEqual([]);
  });
});

describe("unfilteredWrites", () => {
  it("warns on UPDATE and DELETE without WHERE", () => {
    const sql = "UPDATE clientes SET nombre = 'x'; delete from pedidos";
    const d = unfilteredWrites(a(sql));
    expect(marked(sql, d)).toEqual(["UPDATE", "delete"]);
    expect(d.map((x) => x.messageKey)).toEqual(["diag.updateWithoutWhere", "diag.deleteWithoutWhere"]);
    expect(d.every((x) => x.severity === "warning")).toBe(true);
  });

  it("is quiet when there is a WHERE, even after a CTE", () => {
    expect(unfilteredWrites(a("WITH x AS (SELECT 1) DELETE FROM pedidos WHERE id = 1"))).toEqual([]);
  });

  it("does not count a subquery's WHERE as the statement's", () => {
    const sql = "UPDATE pedidos SET total = (SELECT 1 FROM clientes WHERE id = 2)";
    expect(unfilteredWrites(a(sql))).toHaveLength(1);
  });

  it("ignores SELECT, upserts and routine bodies", () => {
    expect(unfilteredWrites(a("SELECT * FROM clientes"))).toEqual([]);
    expect(unfilteredWrites(a("INSERT INTO t (a) VALUES (1) ON DUPLICATE KEY UPDATE a = 2"))).toEqual([]);
    expect(unfilteredWrites(a("CREATE PROCEDURE p() BEGIN DELETE FROM t; END"))).toEqual([]);
  });
});

describe("insertArity", () => {
  it("flags each VALUES row whose count differs from the column list", () => {
    const sql = "INSERT INTO pedidos (id, total) VALUES (1, 2), (3), (4, f(5, 6))";
    const d = insertArity(a(sql), t(sql));
    expect(marked(sql, d)).toEqual(["(3)"]);
    expect(d[0]).toMatchObject({ severity: "error", messageKey: "diag.insertArity", params: { values: 1, columns: 2 } });
  });

  it("is silent without a column list, for INSERT … SELECT and while unclosed", () => {
    expect(insertArity(a("INSERT INTO pedidos VALUES (1)"), t("INSERT INTO pedidos VALUES (1)"))).toEqual([]);
    const sel = "INSERT INTO pedidos (id) SELECT 1, 2";
    expect(insertArity(a(sel), t(sel))).toEqual([]);
    const open = "INSERT INTO pedidos (id, total) VALUES (1";
    expect(insertArity(a(open), t(open))).toEqual([]);
  });
});

describe("sqlDiagnostics", () => {
  it("runs every rule, in document order", () => {
    const sql = "DELETE FROM pedidos; SELECT nombr FROM clientes";
    expect(all(sql).map((d) => d.messageKey)).toEqual(["diag.deleteWithoutWhere", "diag.unknownColumn"]);
  });

  it("finds nothing in valid SQL or in an empty document", () => {
    expect(all("SELECT c.nombre, p.total FROM clientes c JOIN pedidos p ON p.cliente_id = c.id WHERE p.id = 1")).toEqual([]);
    expect(all("")).toEqual([]);
  });
});
