import { describe, it, expect } from "vitest";
import type { ForeignKeyRelation } from "../../src/utils/foreignKeys";
import {
  relatedAvailability,
  relatedCount,
  relatedQueries,
  relatedSelect,
  relationsForColumn,
  invertRelation,
  sqlLiteral,
} from "../../src/utils/relatedData";
import type { ResultColumn } from "../../src/utils/query";

// The real case behind issue #310: cuadernos, referenced by a five-column key.
const rel = (over: Partial<ForeignKeyRelation> = {}): ForeignKeyRelation => ({
  fromTable: "pedido_producto",
  toTable: "cuadernos",
  constraint: "fk_ped_prod",
  columns: [
    { from: "ciudad", to: "ciudad" },
    { from: "anio_ped", to: "anio_ped" },
    { from: "cuaderno", to: "cuaderno" },
    { from: "tipo", to: "tipo" },
    { from: "consec", to: "consec" },
  ],
  ...over,
});

const cols = (...names: string[]): ResultColumn[] =>
  names.map((name) => ({ name, type: "int" }) as ResultColumn);

const KEY_COLS = cols("ciudad", "anio_ped", "cuaderno", "tipo", "consec");
const KEY_ROW = ["8", "2022", "608", "1", "1"];

describe("sqlLiteral", () => {
  it("emits a numeric column unquoted", () => {
    expect(sqlLiteral("608", "int")).toBe("608");
    expect(sqlLiteral("-3.5", "float")).toBe("-3.5");
  });

  it("quotes text, doubling embedded quotes", () => {
    expect(sqlLiteral("O'Brien", "text")).toBe("'O''Brien'");
  });

  it("quotes a non-numeric value even in a numeric column", () => {
    // A numeric column holding something unparsable must not become bare SQL.
    expect(sqlLiteral("1 OR 1=1", "int")).toBe("'1 OR 1=1'");
  });

  it("keeps booleans quoted (engines spell them t/f, TRUE, 1)", () => {
    expect(sqlLiteral("t", "bool")).toBe("'t'");
  });

  it("quotes temporal values", () => {
    expect(sqlLiteral("2022-11-16 14:23:23.000", "timestamp")).toBe(
      "'2022-11-16 14:23:23.000'",
    );
  });
});

describe("relationsForColumn", () => {
  it("keeps the relationships whose referenced key includes the column", () => {
    const other = rel({ fromTable: "otra", columns: [{ from: "id_cuad", to: "id" }] });
    expect(relationsForColumn([rel(), other], "consec")).toHaveLength(1);
    expect(relationsForColumn([rel(), other], "id")[0].fromTable).toBe("otra");
  });

  it("matches the column case-insensitively", () => {
    expect(relationsForColumn([rel()], "CONSEC")).toHaveLength(1);
  });

  it("returns [] when nothing references it", () => {
    expect(relationsForColumn([rel()], "app_login")).toEqual([]);
  });
});

describe("relatedQueries", () => {
  it("filters by the WHOLE key, not just the column opened from", () => {
    const [q] = relatedQueries([rel()], KEY_COLS, KEY_ROW, "informix");
    expect(q.where).toBe(
      "ciudad = 8 AND anio_ped = 2022 AND pedido = 1501 AND tipo = 1 AND consec = 1",
    );
    expect(q.label).toBe(
      "pedido_producto where ciudad=8 and anio_ped=2022 and pedido=1501 and tipo=1 and consec=1",
    );
  });

  it("quotes identifiers per engine", () => {
    const [my] = relatedQueries([rel()], KEY_COLS, KEY_ROW, "mysql");
    expect(my.where).toContain("`ciudad` = 8");
    const [pg] = relatedQueries([rel()], KEY_COLS, KEY_ROW, "postgres");
    expect(pg.where).toContain('"ciudad" = 8');
  });

  it("uses IS NULL for a NULL value instead of an equality", () => {
    const one = rel({ columns: [{ from: "consec_ant", to: "consec" }] });
    const [q] = relatedQueries([one], cols("consec"), [null], "postgres");
    expect(q.where).toBe('"consec_ant" IS NULL');
    expect(q.label).toContain("consec_ant IS NULL");
  });

  it("refuses to filter when the result did not project a key column", () => {
    const [q] = relatedQueries([rel()], cols("ciudad", "anio_ped"), ["8", "2022"], "informix");
    expect(q.where).toBeNull();
    expect(q.missing).toBe("cuaderno");
  });

  it("finds the row's columns case-insensitively", () => {
    const one = rel({ columns: [{ from: "consec", to: "CONSEC" }] });
    const [q] = relatedQueries([one], cols("consec"), ["1"], "postgres");
    expect(q.where).toBe('"consec" = 1');
  });

  it("escapes a text value in the generated filter", () => {
    const one = rel({ columns: [{ from: "login", to: "app_login" }] });
    const columns = [{ name: "app_login", type: "text" }] as ResultColumn[];
    const [q] = relatedQueries([one], columns, ["O'Brien"], "postgres");
    expect(q.where).toBe(`"login" = 'O''Brien'`);
  });
});

describe("relatedSelect / relatedCount", () => {
  const q = () => relatedQueries([rel()], KEY_COLS, KEY_ROW, "informix")[0];

  it("Informix pages with FIRST, not LIMIT", () => {
    const sql = relatedSelect(q(), "informix", { db: "tienda" }, 200)!;
    expect(sql).toBe(
      "SELECT FIRST 200 * FROM tienda:pedido_producto WHERE " +
        "ciudad = 8 AND anio_ped = 2022 AND pedido = 1501 AND tipo = 1 AND consec = 1;",
    );
  });

  it("other engines page with LIMIT and qualify with dots", () => {
    const pg = relatedQueries([rel()], KEY_COLS, KEY_ROW, "postgres")[0];
    const sql = relatedSelect(pg, "postgres", { schema: "public" }, 50)!;
    expect(sql).toContain('FROM "public"."pedido_producto" WHERE');
    expect(sql.endsWith("LIMIT 50;")).toBe(true);
  });

  it("counts with the very same filter", () => {
    const sql = relatedCount(q(), "informix", { db: "tienda" })!;
    expect(sql).toBe(
      "SELECT COUNT(*) FROM tienda:pedido_producto WHERE " +
        "ciudad = 8 AND anio_ped = 2022 AND pedido = 1501 AND tipo = 1 AND consec = 1;",
    );
  });

  it("produces nothing when the relationship cannot be filtered", () => {
    const blocked = relatedQueries([rel()], cols("ciudad"), ["8"], "informix")[0];
    expect(relatedSelect(blocked, "informix")).toBeNull();
    expect(relatedCount(blocked, "informix")).toBeNull();
  });
});

// Issue #344: the menu entry used to vanish whenever any of four conditions
// failed, so "I don't know when it activates, they stopped appearing" was an
// accurate description of the feature. Each cause is now its own answer.
describe("relatedAvailability", () => {
  const rel = (to: string): ForeignKeyRelation => ({
    fromTable: "audiencias",
    toTable: "cuadernos",
    constraint: "fk_det_pedido",
    columns: [{ from: "id_pedido", to }],
  });
  const loaded = (rels: ForeignKeyRelation[]) => ({ rels, reason: null });

  it("is available on a referenced column", () => {
    expect(
      relatedAvailability({ hasSourceTable: true, inbound: loaded([rel("id")]), column: "id" }),
    ).toEqual({ kind: "ok" });
  });

  it("ignores case, like the catalog does", () => {
    expect(
      relatedAvailability({ hasSourceTable: true, inbound: loaded([rel("ID")]), column: "id" }),
    ).toEqual({ kind: "ok" });
  });

  it("says the result is not one table's rows", () => {
    expect(
      relatedAvailability({ hasSourceTable: false, inbound: loaded([rel("id")]), column: "id" }),
    ).toEqual({ kind: "noTable" });
  });

  it("says it is still looking while the catalog has not answered", () => {
    expect(
      relatedAvailability({ hasSourceTable: true, inbound: undefined, column: "id" }),
    ).toEqual({ kind: "checking" });
  });

  it("passes the engine's own reason through when it cannot answer", () => {
    expect(
      relatedAvailability({
        hasSourceTable: true,
        inbound: { rels: [], reason: "MongoDB no declara llaves foráneas." },
        column: "id",
      }),
    ).toEqual({ kind: "unsupported", reason: "MongoDB no declara llaves foráneas." });
  });

  it("distinguishes 'nobody references this table' from 'wrong column'", () => {
    expect(
      relatedAvailability({ hasSourceTable: true, inbound: loaded([]), column: "id" }),
    ).toEqual({ kind: "noReferences" });
    expect(
      relatedAvailability({ hasSourceTable: true, inbound: loaded([rel("id")]), column: "nombre" }),
    ).toEqual({ kind: "otherColumn", columns: ["id"] });
  });

  it("names every referenced column once, so the user knows where to click", () => {
    const state = relatedAvailability({
      hasSourceTable: true,
      inbound: loaded([rel("id"), rel("id"), rel("folio")]),
      column: "nombre",
    });
    expect(state).toEqual({ kind: "otherColumn", columns: ["id", "folio"] });
  });

  it("is available on a column that IS a foreign key, without waiting for the inbound catalog", () => {
    expect(
      relatedAvailability({
        hasSourceTable: true,
        inbound: undefined,
        parentColumns: ["id_pedido"],
        column: "ID_PEDIDO",
      }),
    ).toEqual({ kind: "ok" });
  });

  it("names the foreign-key columns too when the click landed elsewhere", () => {
    expect(
      relatedAvailability({
        hasSourceTable: true,
        inbound: loaded([rel("id")]),
        parentColumns: ["id_sucursal"],
        column: "nombre",
      }),
    ).toEqual({ kind: "otherColumn", columns: ["id", "id_sucursal"] });
  });
});

// The lookup direction (issue #364): the row a cell points AT.
describe("invertRelation", () => {
  const outbound: ForeignKeyRelation = {
    fromTable: "audiencias",
    toTable: "cuadernos",
    constraint: "fk_det_pedido",
    columns: [
      { from: "id_pedido", to: "id" },
      { from: "ciudad", to: "ciudad" },
    ],
  };

  it("swaps the tables and every column pair", () => {
    expect(invertRelation(outbound)).toEqual({
      fromTable: "cuadernos",
      toTable: "audiencias",
      constraint: "fk_det_pedido",
      columns: [
        { from: "id", to: "id_pedido" },
        { from: "ciudad", to: "ciudad" },
      ],
    });
  });

  it("is its own inverse", () => {
    expect(invertRelation(invertRelation(outbound))).toEqual(outbound);
  });

  it("filters the parent table by the values this row holds in its key columns", () => {
    const columns: ResultColumn[] = [
      { name: "id_pedido", type: "int" },
      { name: "ciudad", type: "varchar" },
    ];
    const [q] = relatedQueries([invertRelation(outbound)], columns, ["25", "hermosillo"], "mysql");
    expect(q.where).toBe("`id` = 25 AND `ciudad` = 'hermosillo'");
    expect(q.relation.fromTable).toBe("cuadernos");
    expect(q.label).toBe("cuadernos where id=25 and ciudad=hermosillo");
  });

  it("selects the parent row through the same builder as the dependents", () => {
    const columns: ResultColumn[] = [{ name: "id_pedido", type: "int" }];
    const single = { ...outbound, columns: [{ from: "id_pedido", to: "id" }] };
    const [q] = relatedQueries([invertRelation(single)], columns, ["25"], "mysql");
    expect(relatedSelect(q, "mysql", {})).toBe(
      "SELECT * FROM `cuadernos` WHERE `id` = 25 LIMIT 200;",
    );
  });
});
