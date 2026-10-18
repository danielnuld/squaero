import { describe, it, expect } from "vitest";
import { dropObjectSql } from "../../src/utils/dropObject";

// Issue #463: the tree can delete an object, and what it will run is shown
// verbatim before it runs — so the statement itself is what gets tested.
describe("dropObjectSql", () => {
  it("qualifies a MySQL table with its database", () => {
    expect(dropObjectSql("mysql", { kind: "table", name: "users", db: "app" })).toBe(
      "DROP TABLE `app`.`users`",
    );
  });

  it("qualifies a PostgreSQL view with its schema", () => {
    expect(
      dropObjectSql("postgres", { kind: "view", name: "v_ventas", db: "app", schema: "public" }),
    ).toBe('DROP VIEW "app"."public"."v_ventas"');
  });

  it("drops a PostgreSQL trigger by its table, which is the only way", () => {
    expect(
      dropObjectSql("postgres", {
        kind: "trigger",
        name: "t_stamp",
        schema: "public",
        table: "docs",
      }),
    ).toBe('DROP TRIGGER "t_stamp" ON "public"."docs"');
  });

  it("will not build a PostgreSQL trigger drop without its table", () => {
    expect(dropObjectSql("postgres", { kind: "trigger", name: "t_stamp" })).toBeNull();
  });

  it("takes the bare name on Informix, where the connection names the database", () => {
    expect(dropObjectSql("informix", { kind: "procedure", name: "alta", db: "siaj" })).toBe(
      "DROP PROCEDURE alta",
    );
  });

  it("drops a MySQL routine and a MySQL event", () => {
    expect(dropObjectSql("mariadb", { kind: "function", name: "f", db: "app" })).toBe(
      "DROP FUNCTION `app`.`f`",
    );
    expect(dropObjectSql("mysql", { kind: "event", name: "limpia", db: "app" })).toBe(
      "DROP EVENT `app`.`limpia`",
    );
  });

  it("offers nothing where the engine has no such object", () => {
    expect(dropObjectSql("sqlite", { kind: "procedure", name: "p" })).toBeNull();
    expect(dropObjectSql("postgres", { kind: "event", name: "e" })).toBeNull();
  });

  it("MongoDB: drops a collection or a view of the connection's own database", () => {
    const own = { db: "shop", connDb: "shop" };
    expect(dropObjectSql("mongodb", { kind: "table", name: "orders", ...own })).toBe("db.orders.drop()");
    expect(dropObjectSql("mongodb", { kind: "view", name: "open-orders", ...own })).toBe(
      'db.getCollection("open-orders").drop()',
    );
  });

  it("MongoDB: never drops in a database the statement cannot reach", () => {
    // `db.x.drop()` would hit the connected database's x, not the one in the tree.
    expect(dropObjectSql("mongodb", { kind: "table", name: "x", db: "other", connDb: "shop" })).toBeNull();
    expect(dropObjectSql("mongodb", { kind: "table", name: "x", db: "shop" })).toBeNull();
    expect(dropObjectSql("mongodb", { kind: "table", name: "c" })).toBeNull();
  });

  it("MongoDB has no routines, triggers or events to drop", () => {
    for (const kind of ["procedure", "function", "trigger", "event"] as const) {
      expect(dropObjectSql("mongodb", { kind, name: "x", db: "shop", connDb: "shop" })).toBeNull();
    }
  });

  it("drops a SQLite table and trigger, which it does have", () => {
    expect(dropObjectSql("sqlite", { kind: "table", name: "users" })).toBe('DROP TABLE "users"');
    expect(dropObjectSql("sqlite", { kind: "trigger", name: "t" })).toBe('DROP TRIGGER "t"');
  });
});
