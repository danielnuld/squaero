import { describe, it, expect } from "vitest";
import {
  classifySql,
  confirmListing,
  guardFor,
  parseSafeMode,
  writeStatements,
} from "../../src/utils/safeMode";

// The SQL cases are the core's own (core/tests/query/stmt_class_test.c), so the
// frontend guard and the core's read-only gate agree on the same inputs.
const cases: [string, "empty" | "read" | "write"][] = [
  // empty / trivial
  ["", "empty"],
  ["   \n\t ", "empty"],
  ["-- just a comment", "empty"],
  ["/* only a block comment */", "empty"],
  [";", "empty"],
  // plain reads
  ["SELECT 1", "read"],
  ["  select * from t", "read"],
  ["SELECT * FROM t WHERE x = 1;", "read"],
  ["EXPLAIN SELECT * FROM t", "read"],
  ["SHOW TABLES", "read"],
  ["DESCRIBE t", "read"],
  ["VALUES (1),(2)", "read"],
  ["(SELECT 1)", "read"],
  ["select 1; select 2;", "read"],
  // plain writes / DDL
  ["INSERT INTO t VALUES (1)", "write"],
  ["UPDATE t SET x = 1", "write"],
  ["DELETE FROM t", "write"],
  ["DROP TABLE t", "write"],
  ["CREATE TABLE t (a int)", "write"],
  ["ALTER TABLE t ADD COLUMN b int", "write"],
  ["TRUNCATE t", "write"],
  ["GRANT ALL ON t TO u", "write"],
  ["REPLACE INTO t VALUES (1)", "write"],
  ["CALL do_thing()", "write"],
  ["PRAGMA journal_mode = WAL", "write"],
  ["set autocommit=0", "write"],
  // CTEs
  ["WITH x AS (SELECT 1) SELECT * FROM x", "read"],
  ["with a as (select 1), b as (select 2) select * from a join b", "read"],
  ["WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "write"],
  ["WITH x AS (INSERT INTO t VALUES (1) RETURNING id) SELECT * FROM x", "write"],
  // multi-statement evasion
  ["SELECT 1; DROP TABLE t", "write"],
  ["SELECT 1 ; delete from t ; select 2", "write"],
  // comment evasion
  ["SELECT 1 -- ; DROP TABLE t", "read"],
  ["/* comment */ SELECT 1", "read"],
  ["/* x */ DROP TABLE t", "write"],
  ["SELECT 1; /* c */ DELETE FROM t", "write"],
  ["SELECT 1 /* not a real ; separator */ FROM t", "read"],
  // string-literal evasion
  ["SELECT 'DROP TABLE t' AS note", "read"],
  ["SELECT 'a; DELETE FROM t' FROM dual", "read"],
  ['SELECT "DELETE" FROM t', "read"],
  ["SELECT 'it''s fine; really' FROM t", "read"],
  // quote-escaping evasion: under ANSI the string closes early and the DROP is live
  ["SELECT 'a\\'; DROP TABLE t; -- '", "write"],
  // leading noise
  ["   \n  SELECT 1", "read"],
  ["\t/* c */\n  UPDATE t SET x=1", "write"],
  // rules both gates gained with #666
  ["EXPLAIN ANALYZE SELECT * FROM t", "read"],
  ["EXPLAIN ANALYZE DELETE FROM t", "write"],
  ["EXPLAIN (ANALYZE) UPDATE t SET x = 1", "write"],
  ["SELECT * INTO copy FROM t", "write"],
  ["SELECT a INTO OUTFILE '/tmp/x' FROM t", "write"],
  ["SELECT 'into' AS word FROM t", "read"],
  ["WITH x AS (SELECT 1) SELECT * INTO y FROM x", "write"],
  ["USE ventas", "read"],
  ["EXEC sp_who", "write"],
  ["ANALYZE t", "write"],
  ["merge into t using s on (1=1) when matched then delete", "write"],
];

describe("classifySql (mirrors core stmt_classify)", () => {
  it.each(cases)("%j is %s", (sql, want) => {
    expect(classifySql(sql)).toBe(want);
  });

  it("a multi-line script with comments: one write taints it", () => {
    const script = `-- monthly report
SELECT count(*) FROM orders; /* totals */
SELECT 'DELETE FROM orders' AS hint;
UPDATE orders SET seen = 1 -- oops
;`;
    expect(classifySql(script)).toBe("write");
    expect(classifySql(script.replace(/UPDATE[^;]*/, "SELECT 2"))).toBe("read");
  });
});

describe("classifySql for MongoDB (mongosh surface)", () => {
  const mongo = (q: string) => classifySql(q, "mongodb");
  it("find and aggregate read", () => {
    expect(mongo("db.users.find({})")).toBe("read");
    expect(mongo("db.users.find({ name: 'a' }).sort({ x: 1 }).limit(5)")).toBe("read");
    expect(mongo("db.system.profile.find({})")).toBe("read");
    expect(mongo("db.users.aggregate([{ $match: { a: 1 } }])")).toBe("read");
    expect(mongo("db.users.find({});")).toBe("read");
  });
  it("$out and $merge stages write", () => {
    expect(mongo("db.users.aggregate([{ $match: {} }, { $out: 'copy' }])")).toBe("write");
    expect(mongo('db.users.aggregate([{ "$merge": { into: "x" } }])')).toBe("write");
  });
  it("any other method, or anything not db.<coll>.<m>(), writes", () => {
    expect(mongo("db.users.deleteMany({})")).toBe("write");
    expect(mongo("db.users.insertOne({ a: 1 })")).toBe("write");
    expect(mongo("db.users.drop()")).toBe("write");
    expect(mongo("db.dropDatabase()")).toBe("write");
    expect(mongo("show collections")).toBe("write");
    expect(mongo("db.users.find({}); db.users.drop()")).toBe("write");
  });
  it("a `;` inside a string fails closed (reads as a write)", () => {
    expect(mongo("db.users.find({ name: 'a;b' })")).toBe("write");
  });
  it("empty is empty", () => {
    expect(mongo("  ")).toBe("empty");
  });
  it("SQL rules do not apply to MongoDB, nor mongo rules to SQL", () => {
    expect(classifySql("db.users.find({})")).toBe("write");
    expect(mongo("SELECT 1")).toBe("write");
  });
});

describe("writeStatements", () => {
  it("keeps only the statements that write", () => {
    expect(writeStatements(["SELECT 1", "DELETE FROM t", "", "USE x", "DROP TABLE y"])).toEqual([
      "DELETE FROM t",
      "DROP TABLE y",
    ]);
  });
  it("uses the engine's rules", () => {
    expect(writeStatements(["db.a.find({})", "db.a.drop()"], "mongodb")).toEqual(["db.a.drop()"]);
  });
});

describe("parseSafeMode / guardFor", () => {
  it("accepts only the known modes", () => {
    expect(parseSafeMode("readOnly")).toBe("readOnly");
    expect(parseSafeMode("confirm")).toBe("confirm");
    expect(parseSafeMode("readonly")).toBeUndefined();
    expect(parseSafeMode(1)).toBeUndefined();
    expect(parseSafeMode(undefined)).toBeUndefined();
  });
  it("builds a guard only for a protected connection", () => {
    expect(guardFor({ safeMode: "confirm", driver: "postgres", name: "Prod" })).toEqual({
      mode: "confirm",
      engine: "postgres",
      name: "Prod",
    });
    expect(guardFor({ driver: "postgres", name: "Dev" })).toBeNull();
  });
});

describe("confirmListing", () => {
  it("ends each statement with one semicolon, a blank line apart", () => {
    expect(confirmListing(["DELETE FROM t;", "DROP TABLE x  "])).toBe("DELETE FROM t;\n\nDROP TABLE x;");
  });
  it("counts what it does not print", () => {
    const out = confirmListing(["A", "B", "C"], 2);
    expect(out).toBe("A;\n\nB;\n\n… (+1)");
  });
});
