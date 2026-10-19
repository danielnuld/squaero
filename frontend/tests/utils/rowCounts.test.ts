import { describe, it, expect } from "vitest";
import { parseRowCounts, rowCountSql } from "../../src/utils/rowCounts";

describe("rowCountSql", () => {
  it("reads one catalog statement per engine that keeps counts", () => {
    expect(rowCountSql("mysql", "ventas")).toContain("TABLE_SCHEMA = 'ventas'");
    expect(rowCountSql("mariadb")).toContain("DATABASE()");
    expect(rowCountSql("postgres", "ventas", "public")).toContain("s.nspname = 'public'");
    expect(rowCountSql("mssql", "ventas", "dbo")).toContain("[ventas].sys.partitions");
    expect(rowCountSql("informix", "stores")).toContain("FROM stores:systables");
  });

  it("escapes the names it embeds", () => {
    expect(rowCountSql("postgres", undefined, "o'x")).toContain("'o''x'");
  });

  it("has nothing for engines without catalog counts", () => {
    expect(rowCountSql("sqlite")).toBeNull();
    expect(rowCountSql("mongodb")).toBeNull();
  });
});

describe("parseRowCounts", () => {
  const cols = [{ name: "NAME" }, { name: "n" }];

  it("maps names to whole counts", () => {
    expect(parseRowCounts(cols, [["a", "12"], ["b", "3.6"]])).toEqual({ a: 12, b: 4 });
  });

  it("leaves out what the catalog does not know", () => {
    expect(parseRowCounts(cols, [["never", "-1"], ["nul", null], ["x", "abc"], ["", "3"]])).toEqual({});
  });

  it("is empty when the columns are not there", () => {
    expect(parseRowCounts([{ name: "x" }], [["a"]])).toEqual({});
  });
});
