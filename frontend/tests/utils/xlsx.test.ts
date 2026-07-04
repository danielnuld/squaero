import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  colRef,
  cellRef,
  isNumericCell,
  sanitizeSheetName,
  xmlEscape,
  sheetXml,
  workbookXml,
  buildXlsx,
} from "../../src/utils/xlsx";
import type { ResultSet } from "../../src/utils/query";

const result: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
    { name: "note", type: "text" },
  ],
  rows: [
    ["1", "alice", null],
    ["2", "b<o>b & co", "007"],
  ],
  truncated: false,
  rowsAffected: 0,
};

describe("cell/column references", () => {
  it("maps 0-based indices to spreadsheet columns", () => {
    expect(colRef(0)).toBe("A");
    expect(colRef(25)).toBe("Z");
    expect(colRef(26)).toBe("AA");
    expect(colRef(27)).toBe("AB");
    expect(colRef(701)).toBe("ZZ");
    expect(cellRef(0, 1)).toBe("A1");
    expect(cellRef(2, 3)).toBe("C3");
  });
});

describe("isNumericCell", () => {
  it("is true only for numeric columns whose text round-trips", () => {
    expect(isNumericCell("42", "int")).toBe(true);
    expect(isNumericCell("3.14", "float")).toBe(true);
    // A numeric column but a value that must stay textual (leading zero).
    expect(isNumericCell("007", "int")).toBe(false);
    expect(isNumericCell("", "int")).toBe(false);
    // A non-numeric column is always textual.
    expect(isNumericCell("42", "text")).toBe(false);
  });
});

describe("sanitizeSheetName", () => {
  it("strips forbidden chars and caps at 31 characters", () => {
    expect(sanitizeSheetName("a/b:c*d?[e]")).toBe("a_b_c_d__e_");
    expect(sanitizeSheetName("x".repeat(40)).length).toBe(31);
    expect(sanitizeSheetName("")).toBe("Sheet1");
  });
});

describe("sheetXml", () => {
  it("writes a header row then a data row, typing numeric cells", () => {
    const xml = sheetXml(result);
    // Header cells are inline strings.
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">id</t></is></c>');
    // A round-tripping numeric value becomes a number cell.
    expect(xml).toContain('<c r="A2"><v>1</v></c>');
    // A SQL NULL is an empty cell (no <v>).
    expect(xml).toContain('<c r="C2"/>');
    // Special chars escaped inside an inline string.
    expect(xml).toContain("b&lt;o&gt;b &amp; co");
    // "007" stays a string despite the int column.
    expect(xml).toContain('<c r="C3" t="inlineStr"><is><t xml:space="preserve">007</t></is></c>');
  });
});

describe("workbookXml", () => {
  it("names the sheet, sanitized", () => {
    expect(workbookXml("My/Data")).toContain('name="My_Data"');
  });
});

describe("xmlEscape", () => {
  it("escapes the five XML metacharacters", () => {
    expect(xmlEscape(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

describe("buildXlsx", () => {
  it("produces a valid zip with the required OOXML parts", () => {
    const bytes = buildXlsx(result, "Export");
    expect(bytes).toBeInstanceOf(Uint8Array);
    // A zip local file header starts with 'PK\x03\x04'.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    const files = unzipSync(bytes);
    const names = Object.keys(files).sort();
    expect(names).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/_rels/workbook.xml.rels",
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml",
      ].sort(),
    );
    // The worksheet inside the archive is exactly what sheetXml produced.
    expect(strFromU8(files["xl/worksheets/sheet1.xml"])).toBe(sheetXml(result));
    // The workbook carries the (sanitized) sheet name.
    expect(strFromU8(files["xl/workbook.xml"])).toContain('name="Export"');
  });
});
