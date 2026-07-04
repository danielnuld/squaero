import { describe, it, expect } from "vitest";
import { buildExplain, explainSupported } from "../../src/utils/explain";

describe("buildExplain", () => {
  it("prefixes EXPLAIN for mysql/mariadb/postgres", () => {
    expect(buildExplain("mysql", "SELECT * FROM t")).toBe("EXPLAIN SELECT * FROM t");
    expect(buildExplain("mariadb", "SELECT 1")).toBe("EXPLAIN SELECT 1");
    expect(buildExplain("postgres", "SELECT 1")).toBe("EXPLAIN SELECT 1");
  });

  it("uses EXPLAIN QUERY PLAN for sqlite", () => {
    expect(buildExplain("sqlite", "SELECT * FROM t")).toBe("EXPLAIN QUERY PLAN SELECT * FROM t");
  });

  it("strips a trailing semicolon", () => {
    expect(buildExplain("mysql", "SELECT 1;  ")).toBe("EXPLAIN SELECT 1");
  });

  it("returns null for engines without inline EXPLAIN", () => {
    expect(buildExplain("informix", "SELECT 1")).toBeNull();
    expect(buildExplain("mongodb", "db.c.find({})")).toBeNull();
    expect(buildExplain("", "SELECT 1")).toBeNull();
  });

  it("returns null for empty SQL", () => {
    expect(buildExplain("mysql", "   ")).toBeNull();
  });

  it("explainSupported reflects engine support", () => {
    expect(explainSupported("mysql")).toBe(true);
    expect(explainSupported("sqlite")).toBe(true);
    expect(explainSupported("informix")).toBe(false);
    expect(explainSupported("mongodb")).toBe(false);
  });
});
