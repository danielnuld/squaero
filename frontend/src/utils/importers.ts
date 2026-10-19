// Pure parsing + column mapping for importing a file into a table (#31/#32).
// A CSV or JSON file is parsed into a uniform { headers, rows } table; the user
// maps source headers onto the target table's columns; buildRowValues then turns
// each source row into the {column: value} map the row.insert path consumes. All
// pure and unit-tested — the wizard UI and the transactional apply stay thin.

import type { ResultSet } from "./query";

/** A file parsed into a header row and string/null cells. */
export interface ParsedTable {
  headers: string[];
  rows: (string | null)[][];
}

/** target column -> source header (or null = leave this column unset). */
export type ColumnMapping = Record<string, string | null>;

/** What to do when a row fails to insert. */
export type ErrorPolicy = "skip" | "abort";

/**
 * Parse CSV (RFC 4180): the first record is the header, fields may be quoted
 * with embedded quotes doubled, and quoted fields may contain the delimiter,
 * CR or LF. CSV has no null, so every cell is a (possibly empty) string. A
 * trailing newline does not yield a spurious empty record.
 */
export function parseCsv(text: string, delimiter = ",", quote = '"', header = true): ParsedTable {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let started = false; // any char seen in the current record

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    started = started || ch !== "\r"; // a lone CR before LF doesn't "start" a row
    if (inQuotes) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === quote) {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n") {
      endRecord();
    } else if (ch === "\r") {
      /* swallow; the following \n ends the record (or EOF handles it) */
    } else {
      field += ch;
    }
  }
  // Flush a final record unless the input ended exactly on a record boundary.
  if (started || field.length > 0 || row.length > 0) {
    endRecord();
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }
  if (!header) {
    const width = Math.max(...records.map((r) => r.length));
    return { headers: positionalHeaders(width), rows: records };
  }
  const [headers, ...rows] = records;
  return { headers, rows };
}

/** «#1», «#2», …: the names of the columns of a file without a header row. */
export function positionalHeaders(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `#${i + 1}`);
}

/**
 * Parse a JSON array of objects. Headers are the union of the objects' keys in
 * first-seen order; each row takes the values in that order, with a missing key
 * or JSON null becoming null and any other value stringified. Throws on invalid
 * JSON or a non-array top level (the caller surfaces the message).
 */
export function parseJson(text: string): ParsedTable {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error("El JSON debe ser un arreglo de objetos.");
  }
  const headers: string[] = [];
  for (const obj of data) {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const key of Object.keys(obj)) {
        if (!headers.includes(key)) {
          headers.push(key);
        }
      }
    }
  }
  const rows = data.map((obj) =>
    headers.map((h) => {
      const v = obj?.[h];
      return v === null || v === undefined ? null : String(v);
    }),
  );
  return { headers, rows };
}

/** Pick a parser by file extension, falling back to a content sniff. */
export function parseFile(name: string, text: string): ParsedTable {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return parseJson(text);
  if (!lower.endsWith(".csv") && text.trimStart().startsWith("[")) return parseJson(text);
  const d = detectDialect(text);
  return parseCsv(text, d.delimiter, d.quote, d.header);
}

/**
 * Clipboard text as a table (issue #383).
 *
 * A spreadsheet writes TSV to the clipboard's text/plain flavour; a paste from
 * somewhere else may well be CSV. The delimiter comes from the header line —
 * whichever of tab or comma is in it, tab winning when both are, because a tab
 * inside a spreadsheet cell has to be quoted while a comma does not.
 */
export function parseClipboard(text: string): ParsedTable {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  return parseCsv(text, header.includes("\t") ? "\t" : detectDelimiter(text));
}

/**
 * Empty cells as SQL NULL.
 *
 * Delimited text cannot tell "" from NULL: a spreadsheet writes both as nothing
 * between two separators. Which one lands in the table changes what the row
 * means — and what a NOT NULL column does with it — so it is the user's call,
 * not a guess this module gets to make.
 */
export function emptyAsNull(table: ParsedTable): ParsedTable {
  return {
    headers: table.headers,
    rows: table.rows.map((row) => row.map((cell) => (cell === "" ? null : cell))),
  };
}

/**
 * Default mapping: each target column is mapped to the source header with the
 * same name (case-insensitive), or null when there is no match.
 */
export function autoMap(
  sourceHeaders: string[],
  targetColumns: string[],
): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const col of targetColumns) {
    const match = sourceHeaders.find(
      (h) => h.toLowerCase() === col.toLowerCase(),
    );
    mapping[col] = match ?? null;
  }
  return mapping;
}

/**
 * Build the {column: value} map for one source row from the mapping. Only mapped
 * target columns are included; the target engine applies its own defaults to the
 * rest. A mapped source header not present in this row yields null.
 */
export function buildRowValues(
  mapping: ColumnMapping,
  sourceHeaders: string[],
  row: (string | null)[],
): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (const [target, source] of Object.entries(mapping)) {
    if (source === null) {
      continue;
    }
    const idx = sourceHeaders.indexOf(source);
    values[target] = idx >= 0 ? (row[idx] ?? null) : null;
  }
  return values;
}

/** True when at least one target column is mapped to a source header. */
export function hasMapping(mapping: ColumnMapping): boolean {
  return Object.values(mapping).some((v) => v !== null);
}

/** One failed row, for the import summary. */
export interface ImportError {
  row: number; // 0-based index into the source rows
  message: string;
}

/** Outcome of an import run. */
export interface ImportSummary {
  inserted: number;
  errors: ImportError[];
  /** True when the "abort" policy stopped the run and rolled everything back. */
  aborted: boolean;
}

/**
 * Transaction primitives + a single-row insert, injected so runImport stays pure
 * of the transport and is unit-testable. The wizard wires these to the edit.ts
 * row.insert / tx.* wrappers bound to the target connection and table.
 */
export interface ImportOps {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  insert(values: Record<string, string | null>): Promise<void>;
}

/**
 * Import the parsed rows into the target via `ops`, inside one transaction. Each
 * row is mapped to a {column: value} map and inserted; on a row error the policy
 * decides:
 *   - "skip": record the error and continue; commit the successful rows at the end.
 *   - "abort": roll the whole transaction back and stop (nothing is applied).
 * Returns a summary of inserted rows and per-row errors (#31/#32).
 */
export async function runImport(
  parsed: ParsedTable,
  mapping: ColumnMapping,
  policy: ErrorPolicy,
  ops: ImportOps,
  /** Rows written so far (`done` of `total`), and a Cancel: an aborted run
      rolls the transaction back and rejects with the signal's reason. */
  run: {
    onProgress?: (done: number, total: number) => void;
    /** Each failed row as it fails, for the live error list (R-01). */
    onError?: (error: ImportError) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ImportSummary> {
  const errors: ImportError[] = [];
  let inserted = 0;

  await ops.begin();
  for (let i = 0; i < parsed.rows.length; i++) {
    run.onProgress?.(i, parsed.rows.length);
    if (run.signal?.aborted) {
      await ops.rollback();
      run.signal.throwIfAborted();
    }
    const values = buildRowValues(mapping, parsed.headers, parsed.rows[i]);
    try {
      await ops.insert(values);
      inserted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ row: i, message });
      run.onError?.({ row: i, message });
      if (policy === "abort") {
        await ops.rollback();
        return { inserted: 0, errors, aborted: true };
      }
    }
  }
  run.onProgress?.(parsed.rows.length, parsed.rows.length);
  await ops.commit();
  return { inserted, errors, aborted: false };
}

// --- Reading a delimited file the way it was written (#692, P5) ------------
// A semicolon CSV saved by a Spanish-locale spreadsheet, in Windows-1252, used
// to arrive as one column of mojibake. The wizard detects the dialect, says
// what it found («CSV · punto y coma · UTF-8 · con encabezados») and lets the
// user change any of it.

export type TextEncoding = "utf-8" | "windows-1252" | "utf-16le" | "utf-16be";

export interface CsvDialect {
  delimiter: string;
  quote: string;
  /** The first record names the columns. */
  header: boolean;
}

export const DELIMITERS = [",", ";", "\t", "|"] as const;
export const QUOTES = ['"', "'"] as const;
export const ENCODINGS: TextEncoding[] = ["utf-8", "windows-1252", "utf-16le", "utf-16be"];

/**
 * The encoding of a file's bytes: its BOM when it has one, else UTF-8 when the
 * bytes are valid UTF-8, else Windows-1252 — what a spreadsheet on Windows
 * writes, and a superset of Latin-1, so it never fails to decode.
 */
export function detectEncoding(bytes: Uint8Array): TextEncoding {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

/** The bytes as text in `encoding`, without the BOM. */
export function decodeBytes(bytes: Uint8Array, encoding: TextEncoding): string {
  return new TextDecoder(encoding).decode(bytes);
}

/** The first `n` non-blank lines; cutting at every line break is good enough for a sniff. */
function sampleLines(text: string, n = 20): string[] {
  return text
    .split(/\r?\n/, n + 1)
    .slice(0, n)
    .filter((l) => l.trim() !== "");
}

/** How many times `ch` appears in `line` outside double-quoted stretches. */
function countOutsideQuotes(line: string, ch: string): number {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) n++;
  }
  return n;
}

/**
 * The delimiter of delimited text: the candidate that splits every sampled line
 * into the same number of fields (the most of them, when several do), falling
 * back to the one most frequent in the first line, then to a comma.
 */
export function detectDelimiter(text: string): string {
  const lines = sampleLines(text);
  if (lines.length === 0) return ",";
  let best = "";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    if (counts[0] > bestCount && counts.every((c) => c === counts[0])) {
      best = d;
      bestCount = counts[0];
    }
  }
  if (best) return best;
  for (const d of DELIMITERS) {
    const c = countOutsideQuotes(lines[0], d);
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best || ",";
}

/** The quote character: «'» only when fields open with it and «"» never appears. */
export function detectQuote(text: string, delimiter: string): string {
  const sample = sampleLines(text).join("\n");
  if (sample.includes('"')) return '"';
  const esc = delimiter.replace(/[|\\]/g, "\\$&");
  return new RegExp(`(^|${esc})'`, "m").test(sample) ? "'" : '"';
}

const LOOKS_LIKE_DATA = /^\s*$|^[+-]?\d+([.,]\d+)?$|^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

/**
 * Whether the first record is a header: none of its cells is empty, a number or
 * a date — which a column name never is and a row of data very often is.
 */
export function detectHeader(first: string[]): boolean {
  return first.length > 0 && first.every((c) => !LOOKS_LIKE_DATA.test(c));
}

/** Delimiter, quote and header of delimited text, in one sniff. */
export function detectDialect(text: string): CsvDialect {
  const delimiter = detectDelimiter(text);
  const quote = detectQuote(text, delimiter);
  const first = parseCsv(sampleLines(text, 1).join("\n"), delimiter, quote, false).rows[0] ?? [];
  return { delimiter, quote, header: detectHeader(first) };
}

// --- Mapping onto the target's columns (#692, P5) --------------------------

/** A column of the target table as the mapping step shows it. */
export interface TargetColumn {
  name: string;
  /** The engine's declared type («numeric(10,2)»), "" when not reported. */
  type: string;
  /** The database assigns it (serial, identity, auto increment, SQLite rowid). */
  auto: boolean;
}

/**
 * The target's columns from a schema.describe result. Autoincrement is read
 * from what the engines report: a serial/identity type, a nextval()/identity
 * default, an «auto_increment» extra, or SQLite's single INTEGER PRIMARY KEY
 * (a rowid alias) when `engine` is sqlite.
 */
export function targetColumns(desc: ResultSet, engine?: string): TargetColumn[] {
  const idx = (n: string) => desc.columns.findIndex((c) => c.name === n);
  const ni = idx("name");
  if (ni === -1) return [];
  const ti = idx("type");
  const pi = idx("pk");
  const di = idx("dflt_value") !== -1 ? idx("dflt_value") : idx("default");
  const ei = idx("extra");
  const cell = (r: (string | null)[], i: number) => (i === -1 ? "" : (r[i] ?? ""));
  const isPk = (r: (string | null)[]) => pi !== -1 && !["", "0"].includes(cell(r, pi));
  const pkCount = desc.rows.filter(isPk).length;
  return desc.rows
    .filter((r) => r[ni])
    .map((r) => {
      const type = cell(r, ti);
      const auto =
        /serial|identity|auto_?increment/i.test(`${type} ${cell(r, ei)}`) ||
        /nextval\(|identity|auto_?increment/i.test(cell(r, di)) ||
        (engine === "sqlite" && isPk(r) && pkCount === 1 && /^integer$/i.test(type.trim()));
      return { name: r[ni]!, type, auto };
    });
}

/** Lower case, no accents, letters and digits only: «Teléfono_1» → «telefono1». */
function nameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * «Asignar por nombre»: each target column takes the source header with the
 * same name, ignoring case, accents, spaces and underscores; a column the
 * database assigns (autoincrement) is left to it.
 */
export function mapByName(sourceHeaders: string[], targets: TargetColumn[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const col of targets) {
    mapping[col.name] = col.auto ? null : (sourceHeaders.find((h) => nameKey(h) === nameKey(col.name)) ?? null);
  }
  return mapping;
}

/** How many target columns take a value from the source. */
export function assignedCount(mapping: ColumnMapping): number {
  return Object.values(mapping).filter((v) => v !== null).length;
}

/** The broad kind of a declared type, enough to say whether a value fits it. */
export type TypeFamily = "int" | "num" | "bool" | "date" | "datetime" | "time" | "text";

export function typeFamily(type: string): TypeFamily {
  const t = type.toLowerCase();
  if (/bool|^bit(\(1\))?$/.test(t)) return "bool";
  if (/int|serial/.test(t)) return "int";
  if (/float|double|decimal|numeric|real|money|number/.test(t)) return "num";
  if (/timestamp|datetime/.test(t)) return "datetime";
  if (/date/.test(t)) return "date";
  if (/time/.test(t)) return "time";
  return "text";
}

/**
 * How a source value reads in the target column, for the «Ejemplo» cell of the
 * mapping step. The value itself is sent as it is — the engine converts it —
 * so this only SAYS what it will be: «1 → true», NULL, or a warning when it
 * plainly does not fit (a decimal comma for a number, 31/02/2025 for a date).
 * `warn` is a catalog key.
 */
export function convertPreview(
  value: string | null,
  type: string,
): { text: string; to?: string; warn?: string } {
  if (value === null) return { text: "NULL" };
  const v = value.trim();
  switch (typeFamily(type)) {
    case "bool": {
      const s = v.toLowerCase();
      if (["1", "true", "t", "yes", "y", "sí", "si", "s"].includes(s)) return { text: value, to: "true" };
      if (["0", "false", "f", "no", "n"].includes(s)) return { text: value, to: "false" };
      return { text: value, warn: "imp.warn.bool" };
    }
    case "int":
      return /^[+-]?\d+$/.test(v) ? { text: value } : { text: value, warn: "imp.warn.int" };
    case "num":
      if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v)) return { text: value };
      return { text: value, warn: /^[+-]?\d+,\d+$/.test(v) ? "imp.warn.decimalComma" : "imp.warn.num" };
    case "date":
    case "datetime":
      return validIsoDate(v) ? { text: value } : { text: value, warn: "imp.warn.date" };
    case "time":
      return /^\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v) ? { text: value } : { text: value, warn: "imp.warn.time" };
    default:
      return { text: value };
  }
}

/** An ISO date (optionally followed by a time) that names a real day. */
function validIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})([ T].*)?$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
