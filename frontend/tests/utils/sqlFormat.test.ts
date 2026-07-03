import { describe, it, expect } from "vitest";
import { formatSql, dialectFor } from "../../src/utils/sqlFormat";

describe("dialectFor", () => {
  it("maps known engines to a dialect", () => {
    expect(dialectFor("sqlite")).toBe("sqlite");
    expect(dialectFor("mysql")).toBe("mysql");
    expect(dialectFor("postgres")).toBe("postgresql");
    expect(dialectFor("informix")).toBe("db2");
  });
  it("is case-insensitive and falls back to generic sql", () => {
    expect(dialectFor("MySQL")).toBe("mysql");
    expect(dialectFor("whatever")).toBe("sql");
    expect(dialectFor(undefined)).toBe("sql");
    expect(dialectFor(null)).toBe("sql");
  });
  it("returns null for non-SQL engines (MongoDB)", () => {
    expect(dialectFor("mongodb")).toBeNull();
  });
});

describe("formatSql", () => {
  it("pretty-prints a one-line query into multiple lines", () => {
    const out = formatSql("select a,b from t where x=1", "sqlite");
    expect(out).toMatch(/SELECT/);
    expect(out.split("\n").length).toBeGreaterThan(1);
    expect(out).toContain("FROM");
    expect(out).toContain("WHERE");
  });
  it("preserves string literals verbatim", () => {
    const out = formatSql("select 'Hello, World' as g", "sqlite");
    expect(out).toContain("'Hello, World'");
  });
  it("leaves a MongoDB query untouched (not SQL)", () => {
    const mongo = "db.users.find({ age: 1 }).limit(10)";
    expect(formatSql(mongo, "mongodb")).toBe(mongo);
  });
  it("returns empty/whitespace input unchanged", () => {
    expect(formatSql("", "sqlite")).toBe("");
    expect(formatSql("   \n  ", "sqlite")).toBe("   \n  ");
  });
  it("never throws; returns input on a formatter error", () => {
    // Whatever happens inside, the call is total.
    expect(() => formatSql("::: not really sql :::", "sqlite")).not.toThrow();
    expect(typeof formatSql("::: not really sql :::", "sqlite")).toBe("string");
  });
});
