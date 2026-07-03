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

export type ExportFormat = "csv" | "json" | "sql";

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
  }
}

/** A download file name: `<base>.<ext>` with a format-appropriate extension. */
export function fileNameFor(base: string, format: ExportFormat): string {
  const safe = base.replace(/[^\w.-]+/g, "_") || "export";
  return `${safe}.${format}`;
}
