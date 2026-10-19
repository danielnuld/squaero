import { describe, it, expect } from "vitest";
import { deleteSql, hasTableSql, insertSql, selectSql, truncateSql, updateSql } from "../../src/utils/tableSql";

const t = { db: "ventas", name: "pedidos" };

describe("selectSql", () => {
  it("names the columns when known, else *", () => {
    expect(selectSql(t, "mysql", ["id", "total"])).toBe("SELECT `id`, `total`\nFROM `ventas`.`pedidos`;");
    expect(selectSql({ schema: "public", name: "p" }, "postgres")).toBe('SELECT *\nFROM "public"."p";');
    expect(selectSql({ db: "d", name: "p" }, "informix")).toBe("SELECT *\nFROM d:p;");
  });

  it("is a find() on MongoDB, which has no SQL here", () => {
    expect(hasTableSql("mongodb")).toBe(false);
    expect(selectSql({ name: "c" }, "mongodb")).toBe("db.c.find({})");
  });
});

describe("insert / update / delete", () => {
  it("writes a value variable per column", () => {
    expect(insertSql(t, "mysql", ["id", "nota fija"])).toBe(
      "INSERT INTO `ventas`.`pedidos` (`id`, `nota fija`)\nVALUES (:id, :nota_fija);",
    );
  });

  it("names the row by its primary key", () => {
    expect(updateSql({ name: "p" }, "sqlite", ["id", "a", "b"], ["id"])).toBe(
      'UPDATE "p"\nSET "a" = :a,\n    "b" = :b\nWHERE "id" = :id;',
    );
    expect(deleteSql({ name: "p" }, "mssql", ["k1", "k2", "v"], ["k1", "k2"])).toBe(
      "DELETE FROM [p]\nWHERE [k1] = :k1\n  AND [k2] = :k2;",
    );
  });

  it("falls back to every column without a key", () => {
    expect(deleteSql({ name: "p" }, "sqlite", ["a", "b"], [])).toBe('DELETE FROM "p"\nWHERE "a" = :a\n  AND "b" = :b;');
  });

  it("offers nothing without columns or on MongoDB", () => {
    expect(insertSql(t, "mysql", [])).toBeNull();
    expect(updateSql(t, "mongodb", ["a"], [])).toBeNull();
    expect(deleteSql(t, "mongodb", ["a"], [])).toBeNull();
  });
});

describe("truncateSql", () => {
  it("is TRUNCATE where the engine has it, DELETE on SQLite, none on MongoDB", () => {
    expect(truncateSql(t, "mysql")).toBe("TRUNCATE TABLE `ventas`.`pedidos`");
    expect(truncateSql({ schema: "public", name: "p" }, "postgres")).toBe('TRUNCATE TABLE "public"."p"');
    expect(truncateSql({ name: "p" }, "sqlite")).toBe('DELETE FROM "p"');
    expect(truncateSql({ name: "p" }, "mongodb")).toBeNull();
  });
});
