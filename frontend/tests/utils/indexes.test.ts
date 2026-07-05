import { describe, it, expect } from "vitest";
import {
  indexListFor,
  constraintListFor,
  buildCreateIndex,
  buildDropIndex,
  buildAddConstraint,
  buildDropConstraint,
} from "../../src/utils/indexes";

describe("indexListFor", () => {
  it("MySQL groups columns and scopes by schema + table", () => {
    const l = indexListFor("mysql", "users", "shop");
    expect(l.supported).toBe(true);
    expect(l.nameCol).toBe("name");
    expect(l.sql).toContain("information_schema.STATISTICS");
    expect(l.sql).toContain("TABLE_SCHEMA = 'shop'");
    expect(l.sql).toContain("TABLE_NAME = 'users'");
    expect(l.sql).toContain("GROUP_CONCAT");
  });

  it("MySQL falls back to DATABASE() when no db given", () => {
    expect(indexListFor("mysql", "users").sql).toContain("TABLE_SCHEMA = DATABASE()");
  });

  it("PostgreSQL uses pg_indexes with indexdef", () => {
    const l = indexListFor("postgres", "users", undefined, "public");
    expect(l.sql).toContain("pg_indexes");
    expect(l.sql).toContain("schemaname = 'public'");
    expect(l.detailCols.some((d) => d.col === "definicion")).toBe(true);
  });

  it("SQLite joins pragma_index_list + pragma_index_info", () => {
    const l = indexListFor("sqlite", "t");
    expect(l.sql).toContain("pragma_index_list('t')");
    expect(l.sql).toContain("pragma_index_info(il.name)");
  });

  it("Informix reads sysindices", () => {
    expect(indexListFor("informix", "t").sql).toContain("sysindices");
  });

  it("escapes single quotes in the table name", () => {
    expect(indexListFor("mysql", "o'brien").sql).toContain("TABLE_NAME = 'o''brien'");
  });

  it("unsupported for MongoDB and when no table", () => {
    expect(indexListFor("mongodb", "t").supported).toBe(false);
    expect(indexListFor("mysql", "  ").supported).toBe(false);
  });
});

describe("constraintListFor", () => {
  it("MySQL reads TABLE_CONSTRAINTS with a type column", () => {
    const l = constraintListFor("mysql", "users", "shop");
    expect(l.sql).toContain("information_schema.TABLE_CONSTRAINTS");
    expect(l.typeCol).toBe("tipo");
  });

  it("PostgreSQL normalizes contype to a readable type", () => {
    const l = constraintListFor("postgres", "users", undefined, "public");
    expect(l.sql).toContain("pg_constraint");
    expect(l.sql).toContain("'PRIMARY KEY'");
    expect(l.sql).toContain("'FOREIGN KEY'");
  });

  it("Informix reads sysconstraints with a type case", () => {
    expect(constraintListFor("informix", "t").sql).toContain("sysconstraints");
  });

  it("SQLite is honestly unsupported (no separate catalog)", () => {
    const l = constraintListFor("sqlite", "t");
    expect(l.supported).toBe(false);
    expect(l.reason).toMatch(/SQLite/i);
  });
});

describe("buildCreateIndex", () => {
  it("MySQL: qualified table, backtick columns", () => {
    const r = buildCreateIndex("mysql", { name: "idx_email", table: "users", columns: ["email"], unique: true, container: "shop" });
    expect(r.ok && r.sql).toBe("CREATE UNIQUE INDEX `idx_email` ON `shop`.`users` (`email`)");
  });

  it("PostgreSQL: schema-qualified table, non-unique", () => {
    const r = buildCreateIndex("postgres", { name: "idx", table: "t", columns: ["a", "b"], unique: false, container: "public" });
    expect(r.ok && r.sql).toBe('CREATE INDEX "idx" ON "public"."t" ("a", "b")');
  });

  it("SQLite: table left unqualified even with a container", () => {
    const r = buildCreateIndex("sqlite", { name: "idx", table: "t", columns: ["a"], unique: false, container: "main" });
    expect(r.ok && r.sql).toBe('CREATE INDEX "idx" ON "t" ("a")');
  });

  it("Informix: bare identifiers", () => {
    const r = buildCreateIndex("informix", { name: "idx", table: "t", columns: ["a"], unique: true });
    expect(r.ok && r.sql).toBe("CREATE UNIQUE INDEX idx ON t (a)");
  });

  it("validates name and at least one column", () => {
    expect(buildCreateIndex("mysql", { name: "", table: "t", columns: ["a"], unique: false }).ok).toBe(false);
    expect(buildCreateIndex("mysql", { name: "i", table: "t", columns: [" "], unique: false }).ok).toBe(false);
  });

  it("MongoDB is honestly rejected", () => {
    expect(buildCreateIndex("mongodb", { name: "i", table: "t", columns: ["a"], unique: false }).ok).toBe(false);
  });
});

describe("buildDropIndex", () => {
  it("MySQL needs the table (DROP INDEX ... ON ...)", () => {
    expect(buildDropIndex("mysql", { name: "idx", table: "users", container: "shop" })).toEqual({
      ok: true,
      sql: "DROP INDEX `idx` ON `shop`.`users`",
    });
    expect(buildDropIndex("mysql", { name: "idx", table: "" }).ok).toBe(false);
  });

  it("PostgreSQL drops a schema-qualified index without a table", () => {
    expect(buildDropIndex("postgres", { name: "idx", table: "t", container: "public" })).toEqual({
      ok: true,
      sql: 'DROP INDEX "public"."idx"',
    });
  });

  it("SQLite / Informix: plain DROP INDEX", () => {
    expect(buildDropIndex("sqlite", { name: "idx", table: "t" })).toEqual({ ok: true, sql: 'DROP INDEX "idx"' });
    expect(buildDropIndex("informix", { name: "idx", table: "t" })).toEqual({ ok: true, sql: "DROP INDEX idx" });
  });

  it("MongoDB is honestly rejected", () => {
    expect(buildDropIndex("mongodb", { name: "idx", table: "t" }).ok).toBe(false);
  });
});

describe("buildAddConstraint", () => {
  it("UNIQUE across columns", () => {
    const r = buildAddConstraint("mysql", { kind: "unique", name: "uq_email", table: "users", columns: ["email"] });
    expect(r.ok && r.sql).toBe("ALTER TABLE `users` ADD CONSTRAINT `uq_email` UNIQUE (`email`)");
  });

  it("CHECK with a verbatim expression", () => {
    const r = buildAddConstraint("postgres", { kind: "check", name: "ck_age", table: "p", checkExpr: "age >= 0" });
    expect(r.ok && r.sql).toBe('ALTER TABLE "p" ADD CONSTRAINT "ck_age" CHECK (age >= 0)');
  });

  it("FOREIGN KEY with references", () => {
    const r = buildAddConstraint("postgres", {
      kind: "foreignKey", name: "fk_o", table: "orders", columns: ["customer_id"],
      refTable: "customers", refColumns: ["id"], container: "public",
    });
    expect(r.ok && r.sql).toBe(
      'ALTER TABLE "public"."orders" ADD CONSTRAINT "fk_o" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id")',
    );
  });

  it("Informix puts the constraint name after the definition", () => {
    expect(buildAddConstraint("informix", { kind: "unique", name: "uq", table: "t", columns: ["a"] }))
      .toEqual({ ok: true, sql: "ALTER TABLE t ADD CONSTRAINT UNIQUE (a) CONSTRAINT uq" });
    expect(buildAddConstraint("informix", { kind: "check", name: "ck", table: "t", checkExpr: "a > 0" }))
      .toEqual({ ok: true, sql: "ALTER TABLE t ADD CONSTRAINT CHECK (a > 0) CONSTRAINT ck" });
    expect(buildAddConstraint("informix", { kind: "foreignKey", name: "fk", table: "o", columns: ["cid"], refTable: "c", refColumns: ["id"] }))
      .toEqual({ ok: true, sql: "ALTER TABLE o ADD CONSTRAINT FOREIGN KEY (cid) REFERENCES c (id) CONSTRAINT fk" });
  });

  it("SQLite is honestly rejected", () => {
    const r = buildAddConstraint("sqlite", { kind: "unique", name: "u", table: "t", columns: ["a"] });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/SQLite/i);
  });

  it("validates the body per kind", () => {
    expect(buildAddConstraint("mysql", { kind: "unique", name: "u", table: "t", columns: [] }).ok).toBe(false);
    expect(buildAddConstraint("mysql", { kind: "check", name: "c", table: "t", checkExpr: " " }).ok).toBe(false);
    expect(buildAddConstraint("mysql", { kind: "foreignKey", name: "f", table: "t", columns: ["a"], refTable: "", refColumns: ["b"] }).ok).toBe(false);
  });
});

describe("buildDropConstraint", () => {
  it("MySQL is type-specific", () => {
    const t = "orders";
    expect(buildDropConstraint("mysql", { name: "pk", table: t, type: "PRIMARY KEY" }).ok && buildDropConstraint("mysql", { name: "pk", table: t, type: "PRIMARY KEY" }))
      .toEqual({ ok: true, sql: "ALTER TABLE `orders` DROP PRIMARY KEY" });
    expect(buildDropConstraint("mysql", { name: "fk", table: t, type: "FOREIGN KEY" })).toEqual({ ok: true, sql: "ALTER TABLE `orders` DROP FOREIGN KEY `fk`" });
    expect(buildDropConstraint("mysql", { name: "uq", table: t, type: "UNIQUE" })).toEqual({ ok: true, sql: "ALTER TABLE `orders` DROP INDEX `uq`" });
    expect(buildDropConstraint("mysql", { name: "ck", table: t, type: "CHECK" })).toEqual({ ok: true, sql: "ALTER TABLE `orders` DROP CHECK `ck`" });
    expect(buildDropConstraint("mysql", { name: "x", table: t }).ok).toBe(false); // unknown type
  });

  it("PostgreSQL / Informix use generic DROP CONSTRAINT", () => {
    expect(buildDropConstraint("postgres", { name: "c", table: "t", container: "public" })).toEqual({
      ok: true,
      sql: 'ALTER TABLE "public"."t" DROP CONSTRAINT "c"',
    });
    expect(buildDropConstraint("informix", { name: "c", table: "t" })).toEqual({ ok: true, sql: "ALTER TABLE t DROP CONSTRAINT c" });
  });

  it("SQLite is honestly rejected", () => {
    expect(buildDropConstraint("sqlite", { name: "c", table: "t" }).ok).toBe(false);
  });
});
