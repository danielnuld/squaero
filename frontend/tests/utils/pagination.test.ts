import { describe, it, expect } from "vitest";
import { previewSelect, objectPreviewQuery } from "../../src/utils/pagination";

describe("previewSelect", () => {
  it("uses LIMIT for LIMIT-dialect engines", () => {
    expect(previewSelect("`t`", "mysql", 1000)).toBe("SELECT * FROM `t` LIMIT 1000;");
    expect(previewSelect('"t"', "postgres", 500)).toBe('SELECT * FROM "t" LIMIT 500;');
    expect(previewSelect('"t"', "sqlite", 50)).toBe('SELECT * FROM "t" LIMIT 50;');
  });

  it("uses FIRST for Informix (LIMIT is a syntax error there)", () => {
    expect(previewSelect("stores.informix.customer", "informix", 1000)).toBe(
      "SELECT FIRST 1000 * FROM stores.informix.customer;",
    );
  });

  it("normalizes the engine name via engineFamily (mariadb → mysql)", () => {
    expect(previewSelect("`t`", "mariadb", 100)).toBe("SELECT * FROM `t` LIMIT 100;");
  });

  it("floors and clamps the limit to at least 1", () => {
    expect(previewSelect("t", "mysql", 10.9)).toBe("SELECT * FROM t LIMIT 10;");
    expect(previewSelect("t", "informix", 0)).toBe("SELECT FIRST 1 * FROM t;");
  });

  it("pushes the offset into the query for a later page", () => {
    // LIMIT-dialect: OFFSET clause appended.
    expect(previewSelect("`t`", "mysql", 1000, 2000)).toBe(
      "SELECT * FROM `t` LIMIT 1000 OFFSET 2000;",
    );
    // Informix: SKIP m precedes FIRST n.
    expect(previewSelect("db:owner.t", "informix", 1000, 2000)).toBe(
      "SELECT SKIP 2000 FIRST 1000 * FROM db:owner.t;",
    );
  });

  it("omits the offset clause on the first page (offset 0)", () => {
    expect(previewSelect("`t`", "mysql", 1000, 0)).toBe("SELECT * FROM `t` LIMIT 1000;");
    expect(previewSelect("t", "informix", 1000, 0)).toBe("SELECT FIRST 1000 * FROM t;");
  });

  it("floors and clamps the offset to at least 0", () => {
    expect(previewSelect("t", "mysql", 100, -5)).toBe("SELECT * FROM t LIMIT 100;");
    expect(previewSelect("t", "mysql", 100, 50.9)).toBe("SELECT * FROM t LIMIT 100 OFFSET 50;");
  });
});

describe("objectPreviewQuery", () => {
  it("builds a qualified capped SELECT for relational engines", () => {
    expect(objectPreviewQuery({ db: "app", name: "users" }, "mysql", 1000)).toBe(
      "SELECT * FROM `app`.`users` LIMIT 1000;",
    );
    expect(
      objectPreviewQuery({ db: "prod", schema: "informix", name: "customer" }, "informix", 1000),
    ).toBe("SELECT FIRST 1000 * FROM prod:customer;");
  });

  it("builds a mongosh find().limit() for MongoDB (no SQL surface)", () => {
    expect(objectPreviewQuery({ db: "quaero_test", name: "quaero_it" }, "mongodb", 1000)).toBe(
      "db.quaero_it.find({}).limit(1000)",
    );
  });

  it("floors and clamps the MongoDB limit", () => {
    expect(objectPreviewQuery({ name: "c" }, "mongodb", 5.7)).toBe("db.c.find({}).limit(5)");
  });

  it("pages relational and MongoDB with an offset", () => {
    expect(objectPreviewQuery({ db: "app", name: "users" }, "mysql", 1000, 1000)).toBe(
      "SELECT * FROM `app`.`users` LIMIT 1000 OFFSET 1000;",
    );
    expect(objectPreviewQuery({ name: "c" }, "mongodb", 1000, 2000)).toBe(
      "db.c.find({}).skip(2000).limit(1000)",
    );
  });
});
