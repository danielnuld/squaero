import { describe, expect, it } from "vitest";
import {
  completionName,
  completionKind,
  joinConditions,
  sqlCompletions,
  tableColumns,
  type CompleteOptions,
} from "../../src/utils/sqlComplete";
import { analyzeSql } from "../../src/utils/sqlScope";
import type { ForeignKeyRelation } from "../../src/utils/foreignKeys";

// Contextual completion (issue #661): alias columns, CTE/subquery columns,
// JOIN … ON from real foreign keys, keywords by position.

const schema = {
  tables: ["clientes", "pedidos", "lineas", "Productos"],
  columns: {
    clientes: ["id", "nombre", "ciudad"],
    pedidos: ["id", "cliente_id", "total"],
    lineas: ["pedido_id", "linea", "producto_id"],
    Productos: ["id", "Nombre Largo"],
  },
};

const fks: ForeignKeyRelation[] = [
  { fromTable: "pedidos", toTable: "clientes", constraint: "fk_cli", columns: [{ from: "cliente_id", to: "id" }] },
  {
    fromTable: "lineas",
    toTable: "pedidos",
    constraint: "fk_ped",
    columns: [
      { from: "pedido_id", to: "id" },
      { from: "linea", to: "total" },
    ],
  },
];

/** Completions at the "|" of `marked`. */
function complete(marked: string, opts: CompleteOptions = {}) {
  const pos = marked.indexOf("|");
  return sqlCompletions(marked.replace("|", ""), pos, { schema, foreignKeys: fks, explicit: true, ...opts });
}
const labels = (marked: string, opts?: CompleteOptions) => complete(marked, opts)?.options.map((o) => o.label) ?? null;

describe("sqlCompletions — qualified names", () => {
  it("offers the aliased table's columns after `alias.`", () => {
    expect(labels("SELECT c.| FROM clientes c")).toEqual(["id", "nombre", "ciudad"]);
  });

  it("replaces from the start of the partly typed column", () => {
    const r = complete("SELECT c.nom| FROM clientes c")!;
    expect(r.from).toBe("SELECT c.".length);
  });

  it("offers a CTE's columns through its alias", () => {
    expect(labels("WITH t(a, b) AS (SELECT 1, 2) SELECT x.| FROM t x")).toEqual(["a", "b"]);
  });

  it("offers a derived table's columns", () => {
    expect(labels("SELECT s.| FROM (SELECT id, total AS importe FROM pedidos) s")).toEqual(["id", "importe"]);
  });

  it("quotes names the dialect would not read as written", () => {
    const r = complete("SELECT p.| FROM Productos p", { engine: "mysql" })!;
    expect(r.options.find((o) => o.label === "Nombre Largo")?.apply).toBe("`Nombre Largo`");
    const pg = complete("SELECT p.| FROM Productos p", { engine: "postgres" })!;
    expect(pg.options.find((o) => o.label === "Nombre Largo")?.apply).toBe('"Nombre Largo"');
  });

  it("leaves an unknown qualifier to the fallback", () => {
    expect(complete("SELECT z.| FROM clientes c")).toBeNull();
  });

  it("leaves a relation whose columns are not loaded to the fallback", () => {
    expect(complete("SELECT o.| FROM otra o")).toBeNull();
  });
});

describe("sqlCompletions — JOIN … ON from foreign keys", () => {
  it("offers the condition when the joined table holds the key", () => {
    expect(labels("SELECT * FROM clientes c JOIN pedidos p ON |")).toContain("p.cliente_id = c.id");
  });

  it("offers the condition when the earlier table holds the key", () => {
    expect(labels("SELECT * FROM pedidos p JOIN clientes c ON |")).toContain("p.cliente_id = c.id");
  });

  it("joins every column of a composite key", () => {
    expect(labels("SELECT * FROM pedidos p JOIN lineas l ON |")).toContain("l.pedido_id = p.id AND l.linea = p.total");
  });

  it("offers it without being asked, right after ON", () => {
    expect(labels("SELECT * FROM clientes c JOIN pedidos p ON |", { explicit: false })).toEqual(["p.cliente_id = c.id"]);
  });

  it("offers nothing from keys when none links the tables", () => {
    expect(complete("SELECT * FROM clientes c JOIN lineas l ON |", { explicit: false })).toBeNull();
  });

  it("offers nothing from keys once the condition is under way", () => {
    expect(labels("SELECT * FROM clientes c JOIN pedidos p ON p.cliente_id = |")).not.toContain("p.cliente_id = c.id");
  });

  it("uses the table name when there is no alias", () => {
    expect(labels("SELECT * FROM clientes JOIN pedidos ON |")).toContain("pedidos.cliente_id = clientes.id");
  });

  it("joinConditions ignores derived tables", () => {
    const a = analyzeSql("SELECT * FROM (SELECT 1) s JOIN pedidos p ON 1=1", { schema });
    const [s, p] = a.statements[0].scopes[0].relations;
    expect(joinConditions(p, [s], fks)).toEqual([]);
  });
});

describe("sqlCompletions — keywords by position", () => {
  it("suggests statement keywords at the start", () => {
    expect(labels("|")).toEqual(expect.arrayContaining(["SELECT", "INSERT INTO", "UPDATE"]));
  });

  it("suggests columns, functions and FROM in the select list", () => {
    const l = labels("SELECT | FROM clientes")!;
    expect(l).toEqual(expect.arrayContaining(["id", "nombre", "COUNT", "FROM", "DISTINCT"]));
    expect(l).not.toContain("WHERE");
  });

  it("suggests tables and CTEs right after FROM", () => {
    const l = labels("WITH t AS (SELECT 1 AS a) SELECT * FROM |")!;
    expect(l).toEqual(expect.arrayContaining(["clientes", "pedidos", "t"]));
    expect(l).not.toContain("WHERE");
  });

  it("suggests JOIN and WHERE after a FROM item", () => {
    const l = labels("SELECT * FROM clientes c |")!;
    expect(l).toEqual(expect.arrayContaining(["JOIN", "LEFT JOIN", "WHERE", "ORDER BY"]));
    expect(l).not.toContain("clientes");
  });

  it("suggests columns and AND/OR in WHERE", () => {
    const l = labels("SELECT * FROM clientes WHERE |")!;
    expect(l).toEqual(expect.arrayContaining(["ciudad", "AND", "OR", "ORDER BY"]));
    expect(l).not.toContain("FROM");
  });

  it("adds LIMIT only on engines that have it", () => {
    expect(labels("SELECT * FROM clientes WHERE |", { engine: "sqlite" })).toContain("LIMIT");
    expect(labels("SELECT * FROM clientes WHERE |", { engine: "informix" })).not.toContain("LIMIT");
  });

  it("qualifies a column more than one relation has", () => {
    const l = labels("SELECT * FROM clientes c JOIN pedidos p ON 1=1 WHERE |")!;
    expect(l).toEqual(expect.arrayContaining(["c.id", "p.id", "nombre", "cliente_id"]));
    expect(l).not.toContain("id");
  });

  it("completes BY after ORDER and GROUP", () => {
    expect(labels("SELECT * FROM clientes ORDER |")).toEqual(["BY"]);
    expect(labels("SELECT * FROM clientes group b|")).toEqual(["by"]);
  });

  it("follows the case being typed", () => {
    expect(labels("SELECT * FROM clientes wh|")).toContain("where");
  });

  it("suggests SET after UPDATE's table and the target after UPDATE", () => {
    expect(labels("UPDATE clientes |")).toContain("SET");
    expect(labels("UPDATE |")).toContain("clientes");
  });

  it("suggests the target's columns in SET", () => {
    expect(labels("UPDATE clientes SET |")).toEqual(expect.arrayContaining(["nombre", "WHERE"]));
  });

  it("stays silent with nothing typed unless asked", () => {
    expect(complete("SELECT * FROM clientes WHERE |", { explicit: false })).toBeNull();
  });
});

describe("sqlCompletions — not applicable", () => {
  it("is silent inside a string", () => {
    expect(complete("SELECT * FROM clientes WHERE nombre = 'ab|'")).toBeNull();
    expect(complete("SELECT 'ab|")).toBeNull();
  });

  it("is silent inside a comment", () => {
    expect(complete("SELECT 1 -- note |")).toBeNull();
    expect(complete("SELECT /* x | */ 1")).toBeNull();
  });

  it("copes with incomplete SQL", () => {
    expect(labels("SELECT c.| FROM clientes c JOIN")).toEqual(["id", "nombre", "ciudad"]);
    expect(() => complete("SELECT ((( FROM |")).not.toThrow();
  });

  it("works without a schema", () => {
    expect(labels("SELECT * FROM t WHERE |", { schema: null })).toContain("AND");
  });
});

describe("completionName", () => {
  it("leaves plain names bare and quotes the rest per engine", () => {
    expect(completionName("cliente_id", "postgres")).toBe("cliente_id");
    expect(completionName("Clientes", "postgres")).toBe('"Clientes"');
    expect(completionName("Clientes", "mysql")).toBe("Clientes");
    expect(completionName("a b", "mysql")).toBe("`a b`");
    expect(completionName("a b", "informix")).toBe("a b");
  });
});

describe("completionKind (M14 EditorAutocomplete)", () => {
  it("names each kind in words", () => {
    expect(completionKind({ type: "keyword" })).toBe("complete.kind.keyword");
    expect(completionKind({ type: "class" })).toBe("complete.kind.table");
    expect(completionKind({ type: "class", detail: "CTE" })).toBe("complete.kind.cte");
    expect(completionKind({ type: "type" })).toBe("complete.kind.table");
    expect(completionKind({ type: "property" })).toBe("complete.kind.column");
    expect(completionKind({ type: "function" })).toBe("complete.kind.function");
    expect(completionKind({ type: "text", detail: "FK" })).toBe("complete.kind.join");
  });

  it("says nothing for a kind it cannot name", () => {
    expect(completionKind({ type: "text", detail: "Plantilla · x" })).toBeNull();
    expect(completionKind({})).toBeNull();
  });
});

describe("tableColumns", () => {
  const schema = { tables: ["Clientes", "pedidos"], columns: { Clientes: ["id", "nombre"] } };
  it("lists a table's columns, matched as written or case-insensitively", () => {
    expect(tableColumns(schema, "Clientes")).toEqual(["id", "nombre"]);
    expect(tableColumns(schema, "clientes")).toEqual(["id", "nombre"]);
  });
  it("is null when the columns are not known", () => {
    expect(tableColumns(schema, "pedidos")).toBeNull();
    expect(tableColumns(null, "x")).toBeNull();
  });
});
