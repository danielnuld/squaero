import { describe, it, expect } from "vitest";
import {
  toCsv,
  toJson,
  toInserts,
  toXml,
  toHtml,
  exportResult,
  exportChunks,
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

describe("toXml", () => {
  it("emits a field per column with the name as an attribute, NULL flagged", () => {
    const xml = toXml(result);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<field name="id">1</field>');
    expect(xml).toContain('<field name="note" null="true"/>');
    // Special chars in a value are escaped.
    expect(xml).toContain('<field name="name">b&quot;ob, jr</field>');
  });

  it("escapes angle brackets and ampersands in values", () => {
    const r: ResultSet = {
      columns: [{ name: "v", type: "text" }],
      rows: [["<a> & <b>"]],
      truncated: false,
      rowsAffected: 0,
    };
    expect(toXml(r)).toContain("<field name=\"v\">&lt;a&gt; &amp; &lt;b&gt;</field>");
  });
});

describe("toHtml", () => {
  it("emits a self-contained table with header and rows", () => {
    const html = toHtml(result, "users");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>users</title>");
    expect(html).toContain("<th>id</th>");
    // Numeric column cells get the num class; NULL gets the null class.
    expect(html).toContain('<td class="num">1</td>');
    expect(html).toContain('<td class="null"></td>');
    // HTML-escaped value.
    expect(html).toContain("<td>b&quot;ob, jr</td>");
  });
});

describe("format helpers", () => {
  it("dispatches on format", () => {
    expect(exportResult(result, "csv").startsWith("id,name,note")).toBe(true);
    expect(exportResult(result, "json").startsWith("[")).toBe(true);
    expect(exportResult(result, "sql", "t").startsWith("INSERT INTO")).toBe(true);
    expect(exportResult(result, "xml").includes("<data>")).toBe(true);
    expect(exportResult(result, "html", "t").startsWith("<!doctype html>")).toBe(true);
  });

  it("maps mime types and file names", () => {
    expect(mimeFor("csv")).toBe("text/csv");
    expect(mimeFor("json")).toBe("application/json");
    expect(mimeFor("sql")).toBe("application/sql");
    expect(mimeFor("xml")).toBe("application/xml");
    expect(mimeFor("html")).toBe("text/html");
    expect(fileNameFor("my table", "csv")).toBe("my_table.csv");
    expect(fileNameFor("", "json")).toBe("export.json");
    expect(fileNameFor("t", "xlsx")).toBe("t.xlsx");
  });
});

describe("exportChunks (issue #479)", () => {
  // A million rows in one string is past the engine's maximum string length, and
  // that is exactly how the export failed: "Invalid string length". Pieces are
  // the fix, so what matters is that the pieces still spell the same file.
  const formats = ["csv", "json", "sql", "xml", "html"] as const;

  for (const format of formats) {
    it(`joins back into exactly the ${format} file`, () => {
      const joined = [...exportChunks(result, format, "items", 1)].join("");
      expect(joined).toBe(exportResult(result, format, "items"));
    });

    it(`splits the ${format} file the same way at any chunk size`, () => {
      const whole = exportResult(result, format, "items");
      for (const size of [1, 2, 7, 1000]) {
        expect([...exportChunks(result, format, "items", size)].join("")).toBe(whole);
      }
    });

    it(`still writes an empty ${format} result the same way`, () => {
      const empty: ResultSet = { ...result, rows: [] };
      expect([...exportChunks(empty, format, "items")].join("")).toBe(
        exportResult(empty, format, "items"),
      );
    });
  }

  it("holds only a chunk at a time, not the whole file", () => {
    const many: ResultSet = {
      ...result,
      rows: Array.from({ length: 50 }, (_, i) => [String(i), "x", null]),
    };
    const chunks = [...exportChunks(many, "csv", "items", 10)];
    // Head, five chunks of ten rows, tail — not one piece holding everything.
    expect(chunks.length).toBe(7);
    expect(chunks.every((c) => c.split("\r\n").length <= 11)).toBe(true);
  });
});
