// Pure serializers that turn a result set into an exportable text format (M7/#30):
// CSV (RFC 4180), JSON (array of objects), or SQL INSERT statements. They operate
// on the neutral ResultSet the grid already holds (cells are text or null), so
// export needs no core round-trip. Formatting is pure and unit-tested; the thin
// download trigger (Blob + <a download>) lives in the component layer.
//
// Honest scope: this exports the rows currently loaded in the grid (one page).
// True whole-table streaming would need a core file bridge; see docs and the M8
// decision. `truncated` results export what is loaded.

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
  const objects = result.rows.map((row) => {
    const obj: Record<string, string | null> = {};
    result.columns.forEach((c, i) => {
      obj[c.name] = row[i] ?? null;
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
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
  const cols = result.columns.map((c) => quoteIdent(c.name)).join(", ");
  const qtable = quoteIdent(table);
  return result.rows
    .map((row) => {
      const values = result.columns
        .map((_, i) => sqlLiteral(row[i] ?? null))
        .join(", ");
      return `INSERT INTO ${qtable} (${cols}) VALUES (${values});`;
    })
    .join("\n");
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
  const rows = result.rows
    .map((row) => {
      const fields = result.columns
        .map((c, i) => {
          const name = xmlEscape(c.name);
          const v = row[i] ?? null;
          return v === null
            ? `    <field name="${name}" null="true"/>`
            : `    <field name="${name}">${xmlEscape(v)}</field>`;
        })
        .join("\n");
      return `  <row>\n${fields}\n  </row>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<data>\n${rows}\n</data>\n`;
}

/**
 * HTML: a self-contained document with a styled `<table>` (header + body),
 * for reports or pasting into a document. Numeric cells are right-aligned; a
 * SQL NULL renders as an empty cell marked with a `null` class (respecting the
 * NULL-vs-empty distinction visually).
 */
export function toHtml(result: ResultSet, table = "exported"): string {
  const head = result.columns.map((c) => `<th>${xmlEscape(c.name)}</th>`).join("");
  const body = result.rows
    .map((row) => {
      const cells = result.columns
        .map((c, i) => {
          const v = row[i] ?? null;
          if (v === null) return `<td class="null"></td>`;
          const numeric = classifyType(c.type) === "number";
          return `<td${numeric ? ' class="num"' : ""}>${xmlEscape(v)}</td>`;
        })
        .join("");
      return `      <tr>${cells}</tr>`;
    })
    .join("\n");
  const title = xmlEscape(table);
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${title}</title>\n<style>\n` +
    `body{font-family:system-ui,sans-serif;margin:1rem;}\n` +
    `table{border-collapse:collapse;font-size:13px;}\n` +
    `th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;}\n` +
    `th{background:#f0f0f4;}\ntd.num{text-align:right;}\ntd.null{color:#999;}\n` +
    `</style>\n</head>\n<body>\n<table>\n<thead>\n<tr>${head}</tr>\n</thead>\n` +
    `<tbody>\n${body}\n</tbody>\n</table>\n</body>\n</html>\n`
  );
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
