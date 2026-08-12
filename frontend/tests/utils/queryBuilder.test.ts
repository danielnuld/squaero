import { describe, it, expect } from "vitest";
import {
  buildSelect,
  isNullaryOp,
  emptyCondition,
  renderWhere,
  renderOrderBy,
  type Condition,
  type QuerySpec,
} from "../../src/utils/queryBuilder";

const base = (over: Partial<QuerySpec> = {}): QuerySpec => ({
  table: "users",
  columns: [],
  conditions: [],
  conjunction: "AND",
  orderBy: null,
  limit: null,
  ...over,
});

describe("buildSelect", () => {
  it("SELECT * FROM table by default (mysql backticks)", () => {
    expect(buildSelect("mysql", base())).toBe("SELECT * FROM `users`;");
  });

  it("quotes chosen columns and ANSI-quotes for non-mysql", () => {
    expect(buildSelect("postgres", base({ columns: ["id", "name"] }))).toBe(
      'SELECT "id", "name" FROM "users";',
    );
  });

  it("qualifies the table with a container", () => {
    expect(buildSelect("mysql", base({ container: "shop" }))).toBe(
      "SELECT * FROM `shop`.`users`;",
    );
  });

  it("builds WHERE with literals, joined by the conjunction", () => {
    const sql = buildSelect(
      "mysql",
      base({
        conditions: [
          { column: "age", op: ">", value: "18" },
          { column: "name", op: "LIKE", value: "a%" },
        ],
        conjunction: "OR",
      }),
    );
    expect(sql).toBe("SELECT * FROM `users` WHERE `age` > '18' OR `name` LIKE 'a%';");
  });

  it("handles IS NULL (no value) and IN (list)", () => {
    expect(
      buildSelect("mysql", base({ conditions: [{ column: "deleted", op: "IS NULL", value: "" }] })),
    ).toBe("SELECT * FROM `users` WHERE `deleted` IS NULL;");
    expect(
      buildSelect("mysql", base({ conditions: [{ column: "id", op: "IN", value: "1, 2 ,3" }] })),
    ).toBe("SELECT * FROM `users` WHERE `id` IN ('1', '2', '3');");
  });

  it("escapes single quotes in values", () => {
    expect(
      buildSelect("mysql", base({ conditions: [{ column: "n", op: "=", value: "O'Hara" }] })),
    ).toBe("SELECT * FROM `users` WHERE `n` = 'O''Hara';");
  });

  it("drops conditions with a blank column or empty IN list", () => {
    const sql = buildSelect(
      "mysql",
      base({
        conditions: [
          { column: "", op: "=", value: "x" },
          { column: "tags", op: "IN", value: "  " },
        ],
      }),
    );
    expect(sql).toBe("SELECT * FROM `users`;"); // no WHERE
  });

  it("adds ORDER BY and LIMIT", () => {
    const sql = buildSelect(
      "mysql",
      base({ orderBy: { column: "created", dir: "DESC" }, limit: 50 }),
    );
    expect(sql).toBe("SELECT * FROM `users` ORDER BY `created` DESC LIMIT 50;");
  });

  it("returns empty string with no table", () => {
    expect(buildSelect("mysql", base({ table: "" }))).toBe("");
  });
});

describe("helpers", () => {
  it("isNullaryOp flags value-less operators", () => {
    expect(isNullaryOp("IS NULL")).toBe(true);
    expect(isNullaryOp("IS NOT NULL")).toBe(true);
    expect(isNullaryOp("=")).toBe(false);
  });
  it("emptyCondition is a blank equals row", () => {
    expect(emptyCondition()).toEqual({ column: "", op: "=", value: "" });
  });
});

// Issue #347: the data tab's filter panel needs the WHERE and ORDER BY bodies on
// their own, over a query that is built and paged elsewhere.
describe("renderWhere", () => {
  const c = (over: Partial<Condition>): Condition => ({
    column: "IdUnidad",
    op: "=",
    value: "235",
    ...over,
  });

  it("joins the active conditions with the conjunction", () => {
    expect(
      renderWhere("postgres", [c({}), c({ column: "IdErp", value: "688" })], "AND"),
    ).toBe(`"IdUnidad" = '235' AND "IdErp" = '688'`);
    expect(renderWhere("postgres", [c({}), c({ column: "IdErp" })], "OR")).toContain(" OR ");
  });

  it("leaves an unchecked condition out without losing the rest", () => {
    const where = renderWhere("postgres", [
      c({ enabled: false }),
      c({ column: "IdErp", value: "688" }),
    ]);
    expect(where).toBe(`"IdErp" = '688'`);
  });

  it("treats a condition with no `enabled` as active, for the older builder", () => {
    expect(renderWhere("postgres", [c({})])).not.toBe("");
  });

  it("is empty when every condition is off or unfinished", () => {
    expect(renderWhere("postgres", [c({ enabled: false })])).toBe("");
    expect(renderWhere("postgres", [c({ column: "  " })])).toBe("");
    expect(renderWhere("postgres", [])).toBe("");
  });

  it("quotes numbers as numbers when the column's type says so", () => {
    const types = { IdUnidad: "int" };
    expect(renderWhere("postgres", [c({})], "AND", types)).toBe(`"IdUnidad" = 235`);
    // Case-insensitively: catalogs disagree about the case of a column name.
    expect(renderWhere("postgres", [c({ column: "idunidad" })], "AND", types)).toBe(
      `"idunidad" = 235`,
    );
    // A non-numeric value over a numeric column stays quoted rather than breaking.
    expect(renderWhere("postgres", [c({ value: "n/a" })], "AND", types)).toBe(
      `"IdUnidad" = 'n/a'`,
    );
  });

  it("still quotes everything when no types are known", () => {
    expect(renderWhere("postgres", [c({})])).toBe(`"IdUnidad" = '235'`);
  });

  it("builds IN from a comma list, typed", () => {
    const cond = c({ column: "IdErp", op: "IN", value: "688, 714 ,  " });
    expect(renderWhere("postgres", [cond], "AND", { IdErp: "int" })).toBe(
      `"IdErp" IN (688, 714)`,
    );
    expect(renderWhere("postgres", [cond])).toBe(`"IdErp" IN ('688', '714')`);
  });

  it("wraps CONTAINS in per-cent signs, as text even over a number column", () => {
    const cond = c({ column: "AsuntoFull", op: "CONTAINS", value: "5406" });
    expect(renderWhere("postgres", [cond], "AND", { AsuntoFull: "int" })).toBe(
      `"AsuntoFull" LIKE '%5406%'`,
    );
  });

  it("needs both bounds for BETWEEN, and drops the row without them", () => {
    const between = (value: string) => c({ column: "Fecha", op: "BETWEEN", value });
    expect(renderWhere("postgres", [between("2026-01-01 … 2026-06-30")])).toBe(
      `"Fecha" BETWEEN '2026-01-01' AND '2026-06-30'`,
    );
    expect(renderWhere("postgres", [between("2026-01-01")])).toBe("");
    expect(renderWhere("postgres", [between(" … 2026-06-30")])).toBe("");
  });

  it("needs no value for a null check", () => {
    expect(renderWhere("postgres", [c({ op: "IS NULL", value: "" })])).toBe(
      `"IdUnidad" IS NULL`,
    );
  });

  it("escapes a quote in a value rather than closing the literal", () => {
    expect(renderWhere("postgres", [c({ value: "O'Hara" })])).toBe(
      `"IdUnidad" = 'O''Hara'`,
    );
  });

  it("quotes identifiers the way each engine spells them", () => {
    expect(renderWhere("mysql", [c({})])).toBe("`IdUnidad` = '235'");
  });
});

describe("renderOrderBy", () => {
  it("renders several columns in order", () => {
    expect(
      renderOrderBy("postgres", [
        { column: "IdUnidad", dir: "DESC" },
        { column: "Fecha", dir: "ASC" },
      ]),
    ).toBe(`"IdUnidad" DESC, "Fecha" ASC`);
  });

  it("is empty for no columns, and skips blank ones", () => {
    expect(renderOrderBy("postgres", [])).toBe("");
    expect(renderOrderBy("postgres", [{ column: "  ", dir: "ASC" }])).toBe("");
  });
});
