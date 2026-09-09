// Pure serializers that turn a result set into an exportable text format (M7/#30):
// CSV (RFC 4180), JSON (array of objects), or SQL INSERT statements. They operate
// on the neutral ResultSet the grid already holds (cells are text or null), so
// export needs no core round-trip. Formatting is pure and unit-tested; the thin
// download trigger (Blob + <a download>) lives in the component layer.
//
// Scope: the caller hands in the WHOLE result set (issue #479) — the grid's pages
// plus whatever the core's cursor still holds — and gets the file back in pieces
// (exportChunks). Pieces are not a nicety: a million rows in one string is past
// the engine's maximum string length, and the export died with "Invalid string
// length" the moment somebody exported something real.

import type { ResultSet } from "./query";
import { classifyType } from "./format";

/** Text export formats. XLSX is binary and handled separately (utils/xlsx.ts). */
export type ExportFormat = "csv" | "json" | "sql" | "xml" | "html";

/** A field needs quoting in CSV when it holds the delimiter, a quote, CR or LF. */
function csvField(value: string, delimiter: string): string {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CSV per RFC 4180: a header row of column names, then one row per record, CRLF
 * line endings. A SQL NULL renders as `nullText` (empty by default, so it is
 * indistinguishable from an empty string — the common spreadsheet convention).
 */
export function toCsv(
  result: ResultSet,
  opts: { delimiter?: string; nullText?: string } = {},
): string {
  const delimiter = opts.delimiter ?? ",";
  const nullText = opts.nullText ?? "";
  const line = (cells: string[]) =>
    cells.map((c) => csvField(c, delimiter)).join(delimiter);

  const header = line(result.columns.map((c) => c.name));
  const rows = result.rows.map((row) =>
    line(result.columns.map((_, i) => row[i] ?? nullText)),
  );
  return [header, ...rows].join("\r\n");
}

/**
 * JSON: an array of objects keyed by column name, pretty-printed. A SQL NULL is
 * emitted as JSON null (distinct from an empty string), preserving the model.
 */
export function toJson(result: ResultSet): string {
  return JSON.stringify(
    result.rows.map((row) => jsonRow(result.columns, row)),
    null,
    2,
  );
}

/** One row as an object keyed by column name; a SQL NULL stays null. */
function jsonRow(
  cols: ResultSet["columns"],
  row: (string | null)[],
): Record<string, string | null> {
  const obj: Record<string, string | null> = {};
  cols.forEach((c, i) => {
    obj[c.name] = row[i] ?? null;
  });
  return obj;
}

/** Quote a SQL identifier (ANSI): double quotes, embedded quotes doubled. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** A SQL literal: NULL keyword, else a single-quoted string, quotes doubled. */
function sqlLiteral(value: string | null): string {
  if (value === null) {
    return "NULL";
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * One INSERT statement per row: `INSERT INTO <table> (cols) VALUES (...);`.
 * Uses ANSI identifier quoting and single-quoted literals (values are emitted as
 * strings and coerced by the target engine, matching the row.* edit path). This
 * is a portable dump, not tuned to a specific dialect.
 */
export function toInserts(result: ResultSet, table: string): string {
  const header = insertHeader(result.columns, table);
  return result.rows
    .map((row) => insertRow(header, result.columns, row))
    .join("\n");
}

/** The `INSERT INTO t (a, b) VALUES` every row of a dump repeats. */
function insertHeader(cols: ResultSet["columns"], table: string): string {
  const names = cols.map((c) => quoteIdent(c.name)).join(", ");
  return `INSERT INTO ${quoteIdent(table)} (${names}) VALUES `;
}

function insertRow(
  header: string,
  cols: ResultSet["columns"],
  row: (string | null)[],
): string {
  const values = cols.map((_, i) => sqlLiteral(row[i] ?? null)).join(", ");
  return `${header}(${values});`;
}

/** Escape text for XML/HTML content and attributes: &, <, >, ", '. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * XML: a `<data>` root with one `<row>` per record and a `<field name="…">`
 * per column. The column name is an attribute (so arbitrary/invalid element
 * names are impossible); a SQL NULL is an empty element flagged `null="true"`,
 * preserving the NULL-vs-empty-string distinction of the neutral model.
 */
export function toXml(result: ResultSet): string {
  const rows = result.rows.map((row) => xmlRow(result.columns, row)).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<data>\n${rows}\n</data>\n`;
}

function xmlRow(cols: ResultSet["columns"], row: (string | null)[]): string {
  const fields = cols
    .map((c, i) => {
      const name = xmlEscape(c.name);
      const v = row[i] ?? null;
      return v === null
        ? `    <field name="${name}" null="true"/>`
        : `    <field name="${name}">${xmlEscape(v)}</field>`;
    })
    .join("\n");
  return `  <row>\n${fields}\n  </row>`;
}

/**
 * HTML: a self-contained document with a styled `<table>` (header + body),
 * for reports or pasting into a document. Numeric cells are right-aligned; a
 * SQL NULL renders as an empty cell marked with a `null` class (respecting the
 * NULL-vs-empty distinction visually).
 */
export function toHtml(result: ResultSet, table = "exported"): string {
  const body = result.rows.map((row) => htmlRow(result.columns, row)).join("\n");
  return htmlHead(result.columns, table) + body + htmlTail();
}

function htmlHead(cols: ResultSet["columns"], table: string): string {
  const head = cols.map((c) => `<th>${xmlEscape(c.name)}</th>`).join("");
  const title = xmlEscape(table);
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${title}</title>\n<style>\n` +
    `body{font-family:system-ui,sans-serif;margin:1rem;}\n` +
    `table{border-collapse:collapse;font-size:13px;}\n` +
    `th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;}\n` +
    `th{background:#f0f0f4;}\ntd.num{text-align:right;}\ntd.null{color:#999;}\n` +
    `</style>\n</head>\n<body>\n<table>\n<thead>\n<tr>${head}</tr>\n</thead>\n` +
    `<tbody>\n`
  );
}

function htmlRow(cols: ResultSet["columns"], row: (string | null)[]): string {
  const cells = cols
    .map((c, i) => {
      const v = row[i] ?? null;
      if (v === null) return `<td class="null"></td>`;
      const numeric = classifyType(c.type) === "number";
      return `<td${numeric ? ' class="num"' : ""}>${xmlEscape(v)}</td>`;
    })
    .join("");
  return `      <tr>${cells}</tr>`;
}

function htmlTail(): string {
  return `\n</tbody>\n</table>\n</body>\n</html>\n`;
}

/** Rows per piece. Small enough that no piece approaches a string limit. */
const CHUNK_ROWS = 2000;

/**
 * The file, in pieces, for a caller that writes as it goes (issue #479).
 *
 * Concatenating everything it yields gives exactly what exportResult returns —
 * that is the contract, and the tests pin it — but nothing here ever holds more
 * than a chunk's worth of text, so the size of the export is bounded by the
 * file system rather than by the maximum length of a JavaScript string.
 *
 * A NUMBER of rows per piece rather than a byte budget: rows are what the caller
 * counts for its progress, and a wide row and a narrow one both stay far below
 * any limit at this size.
 */
export function* exportChunks(
  result: ResultSet,
  format: ExportFormat,
  table = "exported",
  rowsPerChunk = CHUNK_ROWS,
): Generator<string> {
  const size = Math.max(1, Math.floor(rowsPerChunk));
  const rows = result.rows;
  const plan = chunkPlan(result, format, table);
  yield plan.head;
  for (let start = 0; start < rows.length; start += size) {
    const end = Math.min(rows.length, start + size);
    let piece = "";
    for (let i = start; i < end; i++) {
      piece += (i === 0 ? plan.firstSep : plan.sep) + plan.row(rows[i], i);
    }
    yield piece;
  }
  yield rows.length > 0 ? plan.tail : plan.emptyTail;
}

/** How one format spells its opening, each row, the joins, and its ending. */
interface ChunkPlan {
  head: string;
  /** Before the first row, which is not always what goes between rows. */
  firstSep: string;
  sep: string;
  row: (row: (string | null)[], index: number) => string;
  tail: string;
  /** Ending for a result with no rows at all. */
  emptyTail: string;
}

function chunkPlan(result: ResultSet, format: ExportFormat, table: string): ChunkPlan {
  const cols = result.columns;
  switch (format) {
    case "csv": {
      const line = (cells: string[]) => cells.map((c) => csvField(c, ",")).join(",");
      return {
        head: line(cols.map((c) => c.name)),
        firstSep: "\r\n",
        sep: "\r\n",
        row: (row) => line(cols.map((_, i) => row[i] ?? "")),
        tail: "",
        emptyTail: "",
      };
    }
    case "json":
      return {
        head: "[",
        firstSep: "\n",
        sep: ",\n",
        row: (row) => indentBy(JSON.stringify(jsonRow(cols, row), null, 2), "  "),
        tail: "\n]",
        emptyTail: "]",
      };
    case "sql": {
      const header = insertHeader(cols, table);
      return {
        head: "",
        firstSep: "",
        sep: "\n",
        row: (row) => insertRow(header, cols, row),
        tail: "",
        emptyTail: "",
      };
    }
    case "xml":
      return {
        head: `<?xml version="1.0" encoding="UTF-8"?>\n<data>\n`,
        firstSep: "",
        sep: "\n",
        row: (row) => xmlRow(cols, row),
        tail: "\n</data>\n",
        emptyTail: "\n</data>\n",
      };
    case "html":
      return {
        head: htmlHead(cols, table),
        firstSep: "",
        sep: "\n",
        row: (row) => htmlRow(cols, row),
        tail: htmlTail(),
        emptyTail: htmlTail(),
      };
  }
}

/** Prefix every line of `text` with `pad` (JSON objects nested in an array). */
function indentBy(text: string, pad: string): string {
  return text
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

/** Serialize a result set to the requested format. `table` names the INSERT target. */
export function exportResult(
  result: ResultSet,
  format: ExportFormat,
  table = "exported",
): string {
  switch (format) {
    case "csv":
      return toCsv(result);
    case "json":
      return toJson(result);
    case "sql":
      return toInserts(result, table);
    case "xml":
      return toXml(result);
    case "html":
      return toHtml(result, table);
  }
}

/** The MIME type to attach to a download of the given format. */
export function mimeFor(format: ExportFormat): string {
  switch (format) {
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "sql":
      return "application/sql";
    case "xml":
      return "application/xml";
    case "html":
      return "text/html";
  }
}

/** A download file name: `<base>.<ext>` with the given extension, sanitized. */
export function fileNameFor(base: string, ext: string): string {
  const safe = base.replace(/[^\w.-]+/g, "_") || "export";
  return `${safe}.${ext}`;
}
