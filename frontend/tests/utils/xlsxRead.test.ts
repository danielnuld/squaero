import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { buildXlsx } from "../../src/utils/xlsx";
import {
  openWorkbook,
  colIndexFromRef,
  isXlsxName,
} from "../../src/utils/xlsxRead";
import type { ResultSet } from "../../src/utils/query";

describe("colIndexFromRef / isXlsxName", () => {
  it("parses A1 column letters to 0-based indices", () => {
    expect(colIndexFromRef("A1")).toBe(0);
    expect(colIndexFromRef("C2")).toBe(2);
    expect(colIndexFromRef("Z10")).toBe(25);
    expect(colIndexFromRef("AA1")).toBe(26);
    expect(colIndexFromRef("AB3")).toBe(27);
  });
  it("detects xlsx names case-insensitively", () => {
    expect(isXlsxName("data.xlsx")).toBe(true);
    expect(isXlsxName("DATA.XLSX")).toBe(true);
    expect(isXlsxName("data.csv")).toBe(false);
  });
});

describe("openWorkbook — inline-string round trip (our own exporter)", () => {
  const result: ResultSet = {
    columns: [
      { name: "id", type: "int" },
      { name: "name", type: "text" },
      { name: "note", type: "text" },
    ],
    rows: [
      ["1", "alice", null],
      ["2", "b<o>b & co", "hello"],
    ],
    truncated: false,
    rowsAffected: 0,
  };

  it("reads back the sheet buildXlsx wrote", () => {
    const wb = openWorkbook(buildXlsx(result, "Export"));
    expect(wb.sheets.map((s) => s.name)).toEqual(["Export"]);
    const table = wb.read("Export");
    expect(table.headers).toEqual(["id", "name", "note"]);
    expect(table.rows).toEqual([
      ["1", "alice", null],
      ["2", "b<o>b & co", "hello"],
    ]);
  });

  it("falls back to the first sheet for an unknown name", () => {
    const wb = openWorkbook(buildXlsx(result, "Export"));
    expect(wb.read("Nope").headers).toEqual(["id", "name", "note"]);
  });
});

describe("openWorkbook — shared strings + typed cells (real Excel shape)", () => {
  // A hand-built workbook using the shared string table (t="s"), a number cell,
  // a gap (missing B in row 3) and a multi-sheet workbook — the shapes a real
  // Excel file produces that our inline-string exporter does not.
  const CONTENT_TYPES =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `</Types>`;
  const ROOT_RELS =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const WORKBOOK =
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Datos" sheetId="1" r:id="rId1"/><sheet name="Otra" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const WORKBOOK_RELS =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;
  const SHARED =
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">` +
    `<si><t>id</t></si><si><t>name</t></si><si><t>Ada</t></si></sst>`;
  // Header row uses shared strings; row 2 has a number in A and shared string in
  // B; row 3 omits B entirely (a gap) and has a number in A.
  const SHEET1 =
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
    `<row r="2"><c r="A2"><v>10</v></c><c r="B2" t="s"><v>2</v></c></row>` +
    `<row r="3"><c r="A3"><v>20</v></c></row>` +
    `</sheetData></worksheet>`;
  const SHEET2 =
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`;

  const bytes = zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(ROOT_RELS),
    "xl/workbook.xml": strToU8(WORKBOOK),
    "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS),
    "xl/sharedStrings.xml": strToU8(SHARED),
    "xl/worksheets/sheet1.xml": strToU8(SHEET1),
    "xl/worksheets/sheet2.xml": strToU8(SHEET2),
  });

  it("lists both sheets in workbook order", () => {
    expect(openWorkbook(bytes).sheets.map((s) => s.name)).toEqual(["Datos", "Otra"]);
  });

  it("resolves shared strings, numbers and a gap cell", () => {
    const table = openWorkbook(bytes).read("Datos");
    expect(table.headers).toEqual(["id", "name"]);
    expect(table.rows).toEqual([
      ["10", "Ada"],
      ["20", null], // B3 omitted -> padded to null
    ]);
  });

  it("reads a different sheet by name (inline string)", () => {
    const table = openWorkbook(bytes).read("Otra");
    expect(table.headers).toEqual(["x"]);
    expect(table.rows).toEqual([]);
  });
});
