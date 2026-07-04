// XLSX (Office Open XML SpreadsheetML) writer for result-set export (issue #141).
// An .xlsx file is a ZIP of a handful of small XML parts. We hand-write the
// minimal valid part set — Content_Types, package + workbook rels, workbook and
// one worksheet — and zip them with fflate (tiny, no native deps), rather than
// pull in a heavy spreadsheet library. Every XML part is produced by a pure,
// unit-tested function; only buildXlsx touches fflate to assemble the archive.
//
// Type fidelity (issue #141 "respeta NULL/tipos"): numeric columns whose value
// round-trips through Number() become real number cells (t="n") so Excel treats
// them as numbers; everything else is an inline string; a SQL NULL is an empty
// cell (no <v>), distinct from an empty string only in that it carries no value.

import { zipSync, strToU8 } from "fflate";
import type { ResultSet } from "./query";
import { classifyType } from "./format";

/** Escape text for XML content / attributes: &, <, >, ", '. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Column letter for a 0-based index: 0->A, 25->Z, 26->AA, … */
export function colRef(index: number): string {
  let n = index;
  let ref = "";
  do {
    ref = String.fromCharCode(65 + (n % 26)) + ref;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return ref;
}

/** A1-style cell reference for a 0-based column and a 1-based row. */
export function cellRef(col: number, row1: number): string {
  return `${colRef(col)}${row1}`;
}

/** True when a value should be written as a spreadsheet number: a numeric column
    whose text round-trips exactly through Number() (guards against precision loss
    on huge integers or values like "007" that must stay textual). */
export function isNumericCell(value: string, type: string): boolean {
  if (classifyType(type) !== "number") return false;
  if (value.trim() === "") return false;
  const n = Number(value);
  return Number.isFinite(n) && String(n) === value;
}

/** Excel limits sheet names to 31 chars and forbids : \ / ? * [ ]. */
export function sanitizeSheetName(name: string): string {
  const clean = name.replace(/[:\\/?*[\]]/g, "_").slice(0, 31);
  return clean || "Sheet1";
}

/** One cell's XML for a value at (col,row1); empty (valueless) for a SQL NULL. */
function cellXml(value: string | null, type: string, col: number, row1: number): string {
  const ref = cellRef(col, row1);
  if (value === null) return `<c r="${ref}"/>`;
  if (isNumericCell(value, type)) return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

/** The worksheet part: a header row of column names, then one row per record. */
export function sheetXml(result: ResultSet): string {
  const cols = result.columns;
  const header =
    `<row r="1">` +
    cols.map((c, i) => cellXml(c.name, "text", i, 1)).join("") +
    `</row>`;
  const body = result.rows
    .map((row, r) => {
      const r1 = r + 2; // header occupies row 1
      const cells = cols.map((c, i) => cellXml(row[i] ?? null, c.type, i, r1)).join("");
      return `<row r="${r1}">${cells}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${header}${body}</sheetData></worksheet>`
  );
}

/** The workbook part naming the single worksheet. */
export function workbookXml(sheetName: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlEscape(sanitizeSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`
  );
}

const CONTENT_TYPES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `</Relationships>`;

/** The MIME type for an .xlsx download. */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Build a complete .xlsx workbook (one sheet) as bytes, ready to save. */
export function buildXlsx(result: ResultSet, sheetName = "Sheet1"): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES_XML),
    "_rels/.rels": strToU8(ROOT_RELS_XML),
    "xl/workbook.xml": strToU8(workbookXml(sheetName)),
    "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS_XML),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(result)),
  });
}
