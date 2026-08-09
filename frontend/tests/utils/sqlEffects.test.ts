import { describe, it, expect } from "vitest";
import { changesCatalog } from "../../src/utils/sqlEffects";

describe("changesCatalog", () => {
  it("is true for every catalog verb", () => {
    expect(changesCatalog("CREATE TABLE t (id INTEGER)")).toBe(true);
    expect(changesCatalog("DROP VIEW v")).toBe(true);
    expect(changesCatalog("ALTER TABLE t ADD c INTEGER")).toBe(true);
    expect(changesCatalog("RENAME TABLE a TO b")).toBe(true);
    expect(changesCatalog("TRUNCATE TABLE t")).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(changesCatalog("  create   view v as select 1  ")).toBe(true);
    expect(changesCatalog("\n\tCrEaTe PROCEDURE p()\n")).toBe(true);
  });

  it("is false for statements that only read or change rows", () => {
    expect(changesCatalog("SELECT * FROM t")).toBe(false);
    expect(changesCatalog("INSERT INTO t VALUES (1)")).toBe(false);
    expect(changesCatalog("UPDATE t SET c = 1")).toBe(false);
    expect(changesCatalog("DELETE FROM t WHERE id = 1")).toBe(false);
    expect(changesCatalog("")).toBe(false);
  });

  it("looks past a leading comment", () => {
    expect(changesCatalog("-- crea la tabla\nCREATE TABLE t (id INTEGER)")).toBe(true);
    expect(changesCatalog("/* nota */ DROP TABLE t")).toBe(true);
  });

  it("finds DDL in any statement of a script, not just the first", () => {
    expect(changesCatalog("SELECT 1; CREATE TABLE t (id INTEGER); SELECT 2")).toBe(true);
  });

  it("ignores a verb inside a comment or a string literal", () => {
    expect(changesCatalog("SELECT 1 -- CREATE TABLE t")).toBe(false);
    expect(changesCatalog("SELECT 'x; CREATE TABLE t' AS c")).toBe(false);
    expect(changesCatalog("INSERT INTO log VALUES ('drop table users')")).toBe(false);
  });

  it("does not fire on a word that merely contains a verb", () => {
    expect(changesCatalog("SELECT * FROM created_at_view")).toBe(false);
    expect(changesCatalog("CALL sp_create_user('a')")).toBe(false);
  });
});
