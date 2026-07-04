import { describe, it, expect } from "vitest";
import {
  buildSelect,
  isNullaryOp,
  emptyCondition,
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
