// The iPhone's export sheet (issue #578, tasks 6.3–6.5): the six formats in
// the order it offers them, the file name kept in step with the format, and a
// reader that opens an exported file again and counts its rows, so a test (and
// the sheet's summary) can check the file holds what was asked for. The files
// themselves come from exporters.ts and xlsx.ts, as on desktop.

import { strFromU8, unzipSync } from "fflate";
import { parseCsv, parseJson } from "./importers";

export const SHEET_FORMATS = ["csv", "json", "xlsx", "xml", "html", "sql"] as const;
export type SheetFormat = (typeof SHEET_FORMATS)[number];

const EXTENSION = /\.(csv|json|xlsx|xml|html|sql)$/i;
/** Characters no file name may carry on iOS or in a share target. */
const UNSAFE = /[/\\:*?"<>|]+/g;

/**
 * `name` with the extension of `format`: a known export extension is replaced,
 * anything else is kept as part of the name ("ventas.2026" stays). Characters a
 * file name cannot hold become "_"; a name left blank becomes "export".
 */
export function nameForFormat(name: string, format: SheetFormat): string {
  const base = name.trim().replace(EXTENSION, "").replace(UNSAFE, "_").trim();
  return `${base || "export"}.${format}`;
}

/** The i18n key describing a format in the sheet. */
export function formatDescriptionKey(format: SheetFormat): string {
  return `ios.export.desc.${format}`;
}

/**
 * The rows an exported file holds, read back from its bytes the way another
 * program would: CSV and JSON parsed (a header is not a row), SQL by its INSERT
 * statements, XML by its <row> elements, HTML by the table's body rows, XLSX by
 * unzipping it and counting the sheet's rows after the header.
 */
export function countExportedRows(format: SheetFormat, bytes: Uint8Array | number[]): number {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (format === "xlsx") {
    const sheet = unzipSync(data)["xl/worksheets/sheet1.xml"];
    if (!sheet) throw new Error("xlsx: no xl/worksheets/sheet1.xml");
    return Math.max(0, count(strFromU8(sheet), /<row\b/g) - 1);
  }
  const text = strFromU8(data);
  switch (format) {
    case "csv":
      return parseCsv(text).rows.length;
    case "json":
      return parseJson(text).rows.length;
    case "sql":
      return count(text, /^INSERT INTO /gm);
    case "xml":
      return count(text, /<row>/g);
    case "html":
      return Math.max(0, count(text, /<tr>/g) - 1);
  }
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}
