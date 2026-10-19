import { describe, it, expect } from "vitest";
import { highlightSql } from "../../src/utils/sqlHighlight";

describe("highlightSql", () => {
  it("keeps every character, in order", () => {
    const sql = "CREATE TABLE t (\n  id INTEGER DEFAULT 0, s TEXT DEFAULT 'x'\n);";
    expect(highlightSql(sql, "sqlite").map((s) => s.text).join("")).toBe(sql);
  });

  it("classes keywords, strings and numbers", () => {
    const spans = highlightSql("SELECT 'a', 1", "postgres");
    const cls = (text: string) => spans.find((s) => s.text === text)?.cls;
    expect(cls("SELECT")).toContain("tok-keyword");
    expect(cls("'a'")).toContain("tok-string");
    expect(cls("1")).toContain("tok-number");
  });

  it("reads backticks as quoted names on MySQL, not as strings", () => {
    const spans = highlightSql("SELECT `x`", "mysql");
    expect(spans.find((s) => s.text === "`x`")?.cls).toBe("tok-string2");
  });

  it("returns nothing for empty text", () => {
    expect(highlightSql("", "sqlite")).toEqual([]);
  });
});
