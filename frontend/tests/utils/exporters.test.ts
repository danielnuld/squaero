import { describe, it, expect } from "vitest";
import {
  toCsv,
  toJson,
  toInserts,
  exportResult,
  mimeFor,
  fileNameFor,
} from "../../src/utils/exporters";
import type { ResultSet } from "../../src/utils/query";

const result: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
    { name: "note", type: "text" },
  ],
  rows: [
    ["1", "alice", null],
    ["2", 'b"ob, jr', "line1\nline2"],
  ],
  truncated: false,
  rowsAffected: 0,
};

describe("toCsv", () => {
  it("writes a header and RFC-4180-quoted fields, CRLF-separated", () => {
    expect(toCsv(result)).toBe(
      'id,name,note\r\n' +
        '1,alice,\r\n' +
        '2,"b""ob, jr","line1\nline2"',
    );
  });

  it("renders SQL NULL with the configured nullText", () => {
    const csv = toCsv(result, { nullText: "\\N" });
    expect(csv.split("\r\n")[1]).toBe("1,alice,\\N");
  });
});

describe("toJson", () => {
  it("emits an array of objects, NULL preserved as JSON null", () => {
    const parsed = JSON.parse(toJson(result));
    expect(parsed).toEqual([
      { id: "1", name: "alice", note: null },
      { id: "2", name: 'b"ob, jr', note: "line1\nline2" },
    ]);
  });
});

describe("toInserts", () => {
  it("emits one INSERT per row with ANSI quoting and NULL keyword", () => {
    const sql = toInserts(result, "users");
    expect(sql).toContain(
      'INSERT INTO "users" ("id", "name", "note") VALUES (\'1\', \'alice\', NULL);',
    );
    // A value with an embedded newline stays inside its literal.
    expect(sql).toContain(
      'INSERT INTO "users" ("id", "name", "note") VALUES (\'2\', \'b"ob, jr\', \'line1\nline2\');',
    );
  });

  it("escapes an embedded single quote by doubling it", () => {
    const r: ResultSet = {
      columns: [{ name: "v", type: "text" }],
      rows: [["O'Hara"]],
      truncated: false,
      rowsAffected: 0,
    };
    expect(toInserts(r, "t")).toBe(
      'INSERT INTO "t" ("v") VALUES (\'O\'\'Hara\');',
    );
  });
});

describe("format helpers", () => {
  it("dispatches on format", () => {
    expect(exportResult(result, "csv").startsWith("id,name,note")).toBe(true);
    expect(exportResult(result, "json").startsWith("[")).toBe(true);
    expect(exportResult(result, "sql", "t").startsWith("INSERT INTO")).toBe(true);
  });

  it("maps mime types and file names", () => {
    expect(mimeFor("csv")).toBe("text/csv");
    expect(mimeFor("json")).toBe("application/json");
    expect(mimeFor("sql")).toBe("application/sql");
    expect(fileNameFor("my table", "csv")).toBe("my_table.csv");
    expect(fileNameFor("", "json")).toBe("export.json");
  });
});
