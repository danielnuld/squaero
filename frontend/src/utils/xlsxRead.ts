// XLSX reader for import (issue #142). Turns an .xlsx workbook (bytes) into the
// same neutral ParsedTable the CSV/JSON import path produces, so it plugs into
// the existing mapping + transactional apply unchanged. An .xlsx is a ZIP of XML
// parts; we unzip with fflate and parse the XML with DOMParser (present in both
// the webview and jsdom), reading real Excel files — which store text in a shared
// string table, not inline like our exporter — as well as inline-string sheets.
//
// Honest scope: values arrive as their textual form (the neutral model is text).
// Dates are stored in XLSX as serial numbers with a style-driven format; we do
// NOT decode them to ISO here (that needs styles.xml numFmt parsing), so a date
// column imports as its serial number. Everything else (text/numbers/booleans)
// round-trips. Pure and unit-tested; the wizard just calls openWorkbook + read.

import { unzipSync, strFromU8 } from "fflate";
import type { ParsedTable } from "./importers";

/** A worksheet exposed to the UI (its part path is resolved internally). */
export interface XlsxSheet {
  name: string;
}

/** An opened workbook: its sheets and a reader for any one of them. */
export interface XlsxWorkbook {
  sheets: XlsxSheet[];
  /** Read a sheet by name into a ParsedTable (first row = headers). Unknown
      name or empty sheet yields an empty table. */
  read(sheetName: string): ParsedTable;
}

type Files = Record<string, Uint8Array>;

function parseXml(bytes: Uint8Array): Document {
  return new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
}

/** 0-based column index from an A1 cell reference: "A1"->0, "C2"->2, "AA1"->26. */
export function colIndexFromRef(ref: string): number {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/** The rId of a <sheet> element, tolerant of how the r: prefix is exposed. */
function sheetRelId(el: Element): string {
  const direct = el.getAttribute("r:id");
  if (direct) return direct;
  for (const a of Array.from(el.attributes)) {
    if (a.name.endsWith(":id") || a.localName === "id") return a.value;
  }
  return "";
}

/** Map rId -> worksheet part path (under xl/) from workbook rels. */
function relTargets(files: Files): Record<string, string> {
  const rels = files["xl/_rels/workbook.xml.rels"];
  const map: Record<string, string> = {};
  if (!rels) return map;
  const doc = parseXml(rels);
  for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
    const id = rel.getAttribute("Id") ?? "";
    const target = (rel.getAttribute("Target") ?? "").replace(/^\/?xl\//, "").replace(/^\//, "");
    if (id && target) map[id] = `xl/${target}`;
  }
  return map;
}

/** The shared string table (xl/sharedStrings.xml), each entry a concatenation of
    its text runs; absent file yields an empty table. */
function sharedStrings(files: Files): string[] {
  const bytes = files["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const doc = parseXml(bytes);
  return Array.from(doc.getElementsByTagName("si")).map((si) =>
    Array.from(si.getElementsByTagName("t"))
      .map((t) => t.textContent ?? "")
      .join(""),
  );
}

/** Resolve one <c> cell to its textual value (or null when empty). */
function cellValue(c: Element, shared: string[]): string | null {
  const t = c.getAttribute("t");
  if (t === "inlineStr") {
    const is = c.getElementsByTagName("is")[0];
    if (!is) return null;
    return Array.from(is.getElementsByTagName("t"))
      .map((n) => n.textContent ?? "")
      .join("");
  }
  const v = c.getElementsByTagName("v")[0];
  const text = v?.textContent ?? null;
  if (t === "s") {
    if (text === null) return null;
    return shared[Number(text)] ?? null;
  }
  // "str" (formula string), "b" (boolean 1/0), numbers, or untyped: raw <v> text.
  return text;
}

/** Read a worksheet part into a ParsedTable, placing cells by their A1 column. */
function readSheetPart(files: Files, path: string, shared: string[]): ParsedTable {
  const bytes = files[path];
  if (!bytes) return { headers: [], rows: [] };
  const doc = parseXml(bytes);
  const rowEls = Array.from(doc.getElementsByTagName("row"));
  const grid: (string | null)[][] = [];
  let width = 0;

  for (const rowEl of rowEls) {
    const arr: (string | null)[] = [];
    for (const c of Array.from(rowEl.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r") ?? "";
      const col = ref ? colIndexFromRef(ref) : arr.length;
      while (arr.length <= col) arr.push(null);
      arr[col] = cellValue(c, shared);
    }
    width = Math.max(width, arr.length);
    grid.push(arr);
  }
  if (grid.length === 0) return { headers: [], rows: [] };

  const pad = (r: (string | null)[]) => {
    const out = r.slice();
    while (out.length < width) out.push(null);
    return out;
  };
  const headerRow = pad(grid[0]);
  const headers = headerRow.map((h, i) => (h ?? "").trim() || `Columna ${i + 1}`);
  const rows = grid.slice(1).map(pad);
  return { headers, rows };
}

/** Open an .xlsx workbook from bytes. Throws if the ZIP is unreadable. */
export function openWorkbook(bytes: Uint8Array): XlsxWorkbook {
  const files = unzipSync(bytes);
  const wb = files["xl/workbook.xml"];
  const targets = relTargets(files);
  const shared = sharedStrings(files);

  const entries: { name: string; path: string }[] = [];
  if (wb) {
    const doc = parseXml(wb);
    Array.from(doc.getElementsByTagName("sheet")).forEach((s, i) => {
      const name = s.getAttribute("name") ?? `Sheet${i + 1}`;
      const path = targets[sheetRelId(s)] ?? "";
      entries.push({ name, path });
    });
  }
  // Fallback: a lone worksheet with no discoverable workbook mapping.
  if (entries.length === 0 && files["xl/worksheets/sheet1.xml"]) {
    entries.push({ name: "Sheet1", path: "xl/worksheets/sheet1.xml" });
  }

  return {
    sheets: entries.map((e) => ({ name: e.name })),
    read(sheetName: string): ParsedTable {
      const entry = entries.find((e) => e.name === sheetName) ?? entries[0];
      if (!entry || !entry.path) return { headers: [], rows: [] };
      return readSheetPart(files, entry.path, shared);
    },
  };
}

/** True when a file name looks like an .xlsx workbook. */
export function isXlsxName(name: string): boolean {
  return name.toLowerCase().endsWith(".xlsx");
}
