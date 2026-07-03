// Pure parsing + column mapping for importing a file into a table (#31/#32).
// A CSV or JSON file is parsed into a uniform { headers, rows } table; the user
// maps source headers onto the target table's columns; buildRowValues then turns
// each source row into the {column: value} map the row.insert path consumes. All
// pure and unit-tested — the wizard UI and the transactional apply stay thin.

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
export function parseCsv(text: string, delimiter = ","): ParsedTable {
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
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
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
  const [headers, ...rows] = records;
  return { headers, rows };
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
  if (lower.endsWith(".csv")) return parseCsv(text);
  return text.trimStart().startsWith("[") ? parseJson(text) : parseCsv(text);
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
): Promise<ImportSummary> {
  const errors: ImportError[] = [];
  let inserted = 0;

  await ops.begin();
  for (let i = 0; i < parsed.rows.length; i++) {
    const values = buildRowValues(mapping, parsed.headers, parsed.rows[i]);
    try {
      await ops.insert(values);
      inserted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ row: i, message });
      if (policy === "abort") {
        await ops.rollback();
        return { inserted: 0, errors, aborted: true };
      }
    }
  }
  await ops.commit();
  return { inserted, errors, aborted: false };
}
