import { describe, it, expect } from "vitest";
import {
  buildLookup,
  fkColumnsOf,
  fkHint,
  fkLookupSql,
  fkValueIndex,
  filterRows,
  FK_LOOKUP_LIMIT,
} from "../../src/utils/fkLookup";
import type { ForeignKey } from "../../src/utils/foreignKeys";
import type { ResultSet } from "../../src/utils/query";

const fks: ForeignKey[] = [
  { fromTable: "pedidos", fromColumn: "cliente_id", toTable: "clientes", toColumn: "id" },
  { fromTable: "pedidos", fromColumn: "vendedor", toTable: "empleados", toColumn: "num" },
  { fromTable: "facturas", fromColumn: "pedido_id", toTable: "pedidos", toColumn: "id" },
];

const clientes: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "nombre", type: "text" },
    { name: "ciudad", type: "text" },
  ],
  rows: [
    ["1", "Ferretería López", "Hermosillo"],
    ["2", "Aceros del Norte", "Obregón"],
    ["13", "Papelería Sol", "Navojoa"],
  ],
  rowsAffected: 3,
  truncated: false,
};

describe("fkColumnsOf", () => {
  it("keeps only the edited table's keys, by its own column", () => {
    expect(fkColumnsOf(fks, "pedidos")).toEqual({
      cliente_id: { toTable: "clientes", toColumn: "id" },
      vendedor: { toTable: "empleados", toColumn: "num" },
    });
  });
  it("matches the table case-insensitively", () => {
    expect(Object.keys(fkColumnsOf(fks, "PEDIDOS"))).toEqual(["cliente_id", "vendedor"]);
  });
  it("keeps the first edge of a composite key and drops incomplete ones", () => {
    const composite: ForeignKey[] = [
      { fromTable: "t", fromColumn: "a", toTable: "u", toColumn: "x" },
      { fromTable: "t", fromColumn: "a", toTable: "u", toColumn: "y" },
      { fromTable: "t", fromColumn: "", toTable: "u", toColumn: "z" },
    ];
    expect(fkColumnsOf(composite, "t")).toEqual({ a: { toTable: "u", toColumn: "x" } });
  });
  it("is empty for a table with no keys", () => {
    expect(fkColumnsOf(fks, "clientes")).toEqual({});
  });
});

describe("fkLookupSql", () => {
  const ref = { toTable: "clientes", toColumn: "id" };
  it("lists the referenced table, capped, in the engine's dialect", () => {
    expect(fkLookupSql(ref, "mysql")).toBe(
      `SELECT * FROM \`clientes\` LIMIT ${FK_LOOKUP_LIMIT};`,
    );
    expect(fkLookupSql(ref, "informix")).toBe(
      `SELECT FIRST ${FK_LOOKUP_LIMIT} * FROM clientes;`,
    );
  });
  it("looks the referenced table up in the edited table's db/schema", () => {
    expect(fkLookupSql(ref, "mysql", { db: "tienda" })).toBe(
      `SELECT * FROM \`tienda\`.\`clientes\` LIMIT ${FK_LOOKUP_LIMIT};`,
    );
    expect(fkLookupSql(ref, "postgres", { schema: "public" })).toBe(
      `SELECT * FROM "public"."clientes" LIMIT ${FK_LOOKUP_LIMIT};`,
    );
  });
});

describe("fkValueIndex", () => {
  it("finds the referenced key, case-insensitively", () => {
    expect(fkValueIndex(clientes.columns, "ID")).toBe(0);
  });
  it("is -1 when the result does not carry it", () => {
    expect(fkValueIndex(clientes.columns, "clave")).toBe(-1);
  });
});

describe("buildLookup", () => {
  const ref = { toTable: "clientes", toColumn: "id" };
  it("keeps the referenced rows WHOLE, so a row can be recognised", () => {
    const lk = buildLookup(ref, clientes)!;
    expect(lk.toTable).toBe("clientes");
    expect(lk.columns.map((c) => c.name)).toEqual(["id", "nombre", "ciudad"]);
    expect(lk.rows.length).toBe(3);
    expect(lk.truncated).toBe(false);
  });
  it("flags a truncated list (a full page came back)", () => {
    const many: ResultSet = {
      ...clientes,
      rows: Array.from({ length: 5 }, (_, i) => [String(i), "x", "y"]),
    };
    expect(buildLookup(ref, many, 5)!.truncated).toBe(true);
  });
  it("offers nothing rather than something wrong", () => {
    // No key column in the result => no browser (we could not say what we'd store).
    expect(buildLookup({ toTable: "clientes", toColumn: "clave" }, clientes)).toBeNull();
    // An empty referenced table => nothing to pick.
    expect(buildLookup(ref, { ...clientes, rows: [] })).toBeNull();
  });
});

describe("filterRows", () => {
  const rows = clientes.rows;
  it("shows every row when nothing is typed", () => {
    expect(filterRows(rows, "").map((r) => r.index)).toEqual([0, 1, 2]);
    expect(filterRows(rows, "   ").length).toBe(3);
  });
  it("searches every column — the whole point is finding the id you forgot", () => {
    expect(filterRows(rows, "lópez").map((r) => r.index)).toEqual([0]);
    expect(filterRows(rows, "OBREGÓN").map((r) => r.index)).toEqual([1]);
  });
  it("matches the key too, and reports the original row index", () => {
    const hit = filterRows(rows, "13");
    expect(hit.length).toBe(1);
    expect(hit[0].index).toBe(2);
    expect(hit[0].row[1]).toBe("Papelería Sol");
  });
  it("is empty when nothing matches", () => {
    expect(filterRows(rows, "zzz")).toEqual([]);
  });
});

describe("fkHint", () => {
  it("reads as the reference it is", () => {
    expect(fkHint({ toTable: "clientes", toColumn: "id" })).toBe("→ clientes.id");
  });
});
