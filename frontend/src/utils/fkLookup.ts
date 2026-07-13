// Foreign-key value browser: when a cell holds a foreign key, let the user SEE
// the rows of the REFERENCED table and pick one, instead of having to remember
// an id ("¿qué datos puedo usar?"). Editing `pedidos.cliente_id` opens `clientes`.
//
// The FK metadata itself is read from the engine's catalog by utils/foreignKeys
// (the same source the ER diagram draws from — no naming heuristics). This module
// turns those edges into what the editor needs:
//   1. which of THIS table's columns are foreign keys (fkColumnsOf),
//   2. the query that lists the referenced table's rows (fkLookupSql, reusing the
//      engine-aware preview SELECT of utils/pagination), and
//   3. the pure filtering the browser dialog does over those rows (filterRows).
//
// The referenced rows are kept WHOLE — every column, not just the key — because
// the point is to recognise the row you want ("Ferretería López"), not to stare
// at ids. The dialog shows them as a small table (see components/FkBrowser).
//
// The referenced table is looked up in the SAME db/schema as the table being
// edited: the FK catalogs report the referenced table by bare name, and a FK
// across databases is impossible on MySQL and vanishingly rare elsewhere.
//
// Everything here is pure; the transport lives in App.tsx (loadFkLookups).

import type { ForeignKey } from "./foreignKeys";
import { objectPreviewQuery } from "./pagination";
import type { ResultColumn, ResultSet } from "./query";

/** How many rows of the referenced table the browser loads. Bounded: it is a
    picker, not a full table view — beyond this, filter by typing. */
export const FK_LOOKUP_LIMIT = 500;

/** Row cap for the FK CATALOG query. It is scoped to one table (see
    foreignKeysFor), so this only has to cover one table's keys — but it is sent
    explicitly, because query.run's own default cap is what silently dropped the
    edited table from a whole-database FK listing in the first place. */
export const FK_CATALOG_LIMIT = 200;

/** The table/column one column of the edited table points at. */
export interface FkRef {
  toTable: string;
  toColumn: string;
}

/** A FK column's browser: where it points, and the referenced rows to choose from. */
export interface FkLookup extends FkRef {
  columns: ResultColumn[];
  rows: (string | null)[][];
  /** The referenced table has more rows than were fetched, so the list is a
      prefix — the dialog says so rather than implying these are all the valid
      values. */
  truncated?: boolean;
}

/**
 * The foreign keys of `table`, keyed by ITS column. Names are compared
 * case-insensitively (catalogs differ in case between engines), and the first
 * edge wins for a composite key — a composite FK cannot be chosen as one value,
 * so its columns are simply offered independently.
 */
export function fkColumnsOf(fks: ForeignKey[], table: string): Record<string, FkRef> {
  const out: Record<string, FkRef> = {};
  const want = table.trim().toLowerCase();
  for (const fk of fks) {
    if (fk.fromTable.trim().toLowerCase() !== want) continue;
    if (!fk.fromColumn || !fk.toTable || !fk.toColumn) continue;
    if (!(fk.fromColumn in out)) {
      out[fk.fromColumn] = { toTable: fk.toTable, toColumn: fk.toColumn };
    }
  }
  return out;
}

/** The query listing a referenced table's rows, in the engine's own dialect
    (Informix gets FIRST, everyone else LIMIT — see utils/pagination). `scope` is
    the db/schema of the table being edited; see the module comment. */
export function fkLookupSql(
  ref: FkRef,
  engine: string,
  scope: { db?: string; schema?: string } = {},
  limit = FK_LOOKUP_LIMIT,
): string {
  return objectPreviewQuery(
    { db: scope.db, schema: scope.schema, name: ref.toTable },
    engine,
    limit,
  );
}

/**
 * Index of the referenced key within the lookup result's columns, or -1 when the
 * result does not carry it (an odd catalog, a view). The caller then offers no
 * browser at all rather than one that cannot say which value it would store.
 */
export function fkValueIndex(columns: ResultColumn[], toColumn: string): number {
  const key = toColumn.trim().toLowerCase();
  return columns.findIndex((c) => c.name.trim().toLowerCase() === key);
}

/** Build the browser's data from a lookup result, or null when the key column is
    missing (see fkValueIndex) — no picker beats a picker that guesses. */
export function buildLookup(
  ref: FkRef,
  result: ResultSet,
  limit = FK_LOOKUP_LIMIT,
): FkLookup | null {
  if (result.rows.length === 0) return null;
  if (fkValueIndex(result.columns, ref.toColumn) === -1) return null;
  return {
    ...ref,
    columns: result.columns,
    rows: result.rows,
    // A full page back means the table has more rows than we fetched.
    truncated: result.rows.length >= limit,
  };
}

/**
 * The rows the browser shows for what the user typed: a case-insensitive
 * substring match over EVERY cell of the row — typing "lópez" finds the cliente
 * whose id you do not remember, which is the whole point. An empty query shows
 * every row. Returns the original row indices so the caller can read the key
 * from the untouched row.
 */
export function filterRows(
  rows: (string | null)[][],
  query: string,
): { row: (string | null)[]; index: number }[] {
  const q = query.trim().toLowerCase();
  const out: { row: (string | null)[]; index: number }[] = [];
  rows.forEach((row, index) => {
    if (q === "" || row.some((cell) => (cell ?? "").toLowerCase().includes(q))) {
      out.push({ row, index });
    }
  });
  return out;
}

/** The one-line hint shown on a FK cell: `→ clientes.id`. */
export function fkHint(ref: FkRef): string {
  return `→ ${ref.toTable}.${ref.toColumn}`;
}
