// Pure per-engine SQL + parsing for REAL foreign keys (issue #260). The ER
// diagram used to infer relationships from column naming (`customer_id` ->
// `customers`), which produces false positives (any `*_id` that happens to match
// a table name) and false negatives (FKs that don't follow the convention, e.g.
// `owner`, `id_cliente`). Here we read the engine's actual FK metadata and draw
// those edges, keeping the name inference only as a fallback for engines that
// don't expose FKs (MongoDB) — see utils/erDiagram.ts (realEdges) and
// components/ErDiagram.tsx.
//
// Catalogs differ per engine:
//   MySQL/MariaDB — information_schema.KEY_COLUMN_USAGE (one row per FK column,
//                   ordered by ORDINAL_POSITION so composite keys stay ordered).
//   PostgreSQL    — pg_constraint (contype='f') unnested against pg_attribute so
//                   each column pair of a (possibly composite) FK is one row.
//   SQLite        — PRAGMA foreign_key_list(<table>): must be run per table, so
//                   this engine reports `perTable` and the source table is
//                   injected at parse time (the pragma doesn't echo it).
//   Informix      — sysconstraints (constrtype='R') + sysreferences, resolving
//                   the FIRST column of the local/referenced index via sysindexes
//                   part1 (full multi-column resolution over part1..16 is omitted,
//                   same pragmatic limitation as utils/indexes.ts — composite
//                   Informix FKs show their first column pair only, documented).
//   MongoDB       — no foreign keys; honestly unsupported (falls back to naming).
//
// The SQL for the bulk engines aliases its output columns to a single shape
// (from_table, from_column, to_table, to_column) so parseForeignKeys reads them
// engine-agnostically. Everything here is pure and unit-tested.

import { engineFamily as family } from "./engineFamily";

/** One resolved foreign-key column pair: fromTable.fromColumn -> toTable.toColumn. */
export interface ForeignKey {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/** How to obtain an engine's foreign keys (or why we can't). */
export interface ForeignKeyQuery {
  /** The engine exposes FK metadata we can query. */
  supported: boolean;
  /** FKs must be fetched one query per table (SQLite); use sqliteForeignKeySql. */
  perTable: boolean;
  /** A single query returning every FK in the db scope (null when perTable/unsupported). */
  bulkSql: string | null;
  /** Honest reason shown when unsupported. */
  reason: string | null;
}

/** Standard SQL string literal: double embedded single quotes. PostgreSQL,
    SQLite and Informix treat backslash as an ordinary character, so nothing else
    is needed there. */
const lit = (s: string) => s.replace(/'/g, "''");

/** MySQL/MariaDB literal: its default sql_mode treats backslash as an escape
    character, so double backslashes too (before quotes). */
const litMy = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "''");

const unsupported = (reason: string): ForeignKeyQuery => ({
  supported: false,
  perTable: false,
  bulkSql: null,
  reason,
});

/**
 * The FK-query plan for an engine. `db` scopes the catalog to the working
 * database/schema; engines already scoped to one database (SQLite) ignore it.
 *
 * `table` narrows the answer to ONE table's foreign keys. Pass it whenever only
 * that table matters (the value picker of an edit session): a whole-database FK
 * listing is not just wasteful, it is unsafe to rely on — query.run caps the rows
 * it returns (IPC_QUERY_DEFAULT_LIMIT), and a schema with a few thousand foreign
 * keys silently loses the tail, so the table you were editing may simply not be
 * in the answer. The ER diagram, which genuinely wants them all, omits it.
 */
export function foreignKeysFor(engine: string, db?: string, table?: string): ForeignKeyQuery {
  const scope = (db ?? "").trim();
  const only = (table ?? "").trim();
  switch (family(engine)) {
    case "mysql": {
      const dbScope = scope ? `'${litMy(scope)}'` : "DATABASE()";
      const tableScope = only ? ` AND TABLE_NAME = '${litMy(only)}'` : "";
      return {
        supported: true,
        perTable: false,
        bulkSql:
          "SELECT TABLE_NAME AS from_table, COLUMN_NAME AS from_column, " +
          "REFERENCED_TABLE_NAME AS to_table, REFERENCED_COLUMN_NAME AS to_column " +
          "FROM information_schema.KEY_COLUMN_USAGE " +
          `WHERE TABLE_SCHEMA = ${dbScope} AND REFERENCED_TABLE_NAME IS NOT NULL${tableScope} ` +
          "ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
        reason: null,
      };
    }
    case "postgres": {
      // Unnest conkey/confkey together so column i of the FK pairs with column i
      // of the referenced key (keeps composite FKs ordered and correctly paired).
      const nsScope = scope
        ? `n.nspname = '${lit(scope)}'`
        : "n.nspname NOT IN ('pg_catalog', 'information_schema')";
      const tableScope = only ? ` AND cl.relname = '${lit(only)}'` : "";
      return {
        supported: true,
        perTable: false,
        bulkSql:
          "SELECT cl.relname AS from_table, a.attname AS from_column, " +
          "cf.relname AS to_table, af.attname AS to_column " +
          "FROM pg_constraint con " +
          "JOIN pg_class cl ON cl.oid = con.conrelid " +
          "JOIN pg_class cf ON cf.oid = con.confrelid " +
          "JOIN pg_namespace n ON n.oid = cl.relnamespace " +
          "JOIN generate_subscripts(con.conkey, 1) AS k(i) ON true " +
          "JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[k.i] " +
          "JOIN pg_attribute af ON af.attrelid = con.confrelid AND af.attnum = con.confkey[k.i] " +
          `WHERE con.contype = 'f' AND ${nsScope}${tableScope} ` +
          "ORDER BY cl.relname, con.conname, k.i",
        reason: null,
      };
    }
    case "informix":
      // First column pair only (part1); multi-column FKs show their first pair.
      return {
        supported: true,
        perTable: false,
        bulkSql:
          "SELECT TRIM(t.tabname) AS from_table, TRIM(fc.colname) AS from_column, " +
          "TRIM(pt.tabname) AS to_table, TRIM(pc.colname) AS to_column " +
          "FROM sysconstraints c " +
          "JOIN systables t ON t.tabid = c.tabid " +
          "JOIN sysreferences r ON r.constrid = c.constrid " +
          "JOIN systables pt ON pt.tabid = r.ptabid " +
          "JOIN sysindexes fi ON fi.idxname = c.idxname AND fi.tabid = c.tabid " +
          "JOIN syscolumns fc ON fc.tabid = c.tabid AND fc.colno = fi.part1 " +
          "JOIN sysconstraints pk ON pk.constrid = r.primary " +
          "JOIN sysindexes pi ON pi.idxname = pk.idxname AND pi.tabid = pk.tabid " +
          "JOIN syscolumns pc ON pc.tabid = pk.tabid AND pc.colno = pi.part1 " +
          "WHERE c.constrtype = 'R' AND t.tabid > 99 " +
          (only ? `AND t.tabname = '${lit(only)}' ` : "") +
          "ORDER BY t.tabname",
        reason: null,
      };
    case "sqlite":
      // PRAGMA foreign_key_list is per table; see sqliteForeignKeySql.
      return { supported: true, perTable: true, bulkSql: null, reason: null };
    case "mongodb":
      return unsupported("MongoDB no tiene llaves foráneas; se usan relaciones inferidas por nombre.");
    default:
      return unsupported("Este motor no expone llaves foráneas en catálogos.");
  }
}

/** Per-table SQLite FK query. Columns: id, seq, table (referenced), from, to, … */
export function sqliteForeignKeySql(table: string): string {
  return `PRAGMA foreign_key_list('${lit(table)}')`;
}

const cell = (v: string | null | undefined): string => (v === null || v === undefined ? "" : String(v));

/**
 * Parse a FK-query result into ForeignKey[]. For SQLite the pragma echoes no
 * source table, so `sourceTable` (the pragma argument) is injected. For the bulk
 * engines the columns are read by their aliased names. Rows missing a source
 * column or referenced table are dropped (defensive against odd catalogs).
 */
export function parseForeignKeys(
  engine: string,
  columns: { name: string }[],
  rows: (string | null)[][],
  sourceTable?: string,
): ForeignKey[] {
  const idx = (name: string) => columns.findIndex((c) => c.name.toLowerCase() === name);

  if (family(engine) === "sqlite") {
    const ti = idx("table");
    const fi = idx("from");
    const toi = idx("to");
    if (ti < 0 || fi < 0) return [];
    return rows
      .map((r) => ({
        fromTable: (sourceTable ?? "").trim(),
        fromColumn: cell(r[fi]).trim(),
        toTable: cell(r[ti]).trim(),
        toColumn: toi >= 0 ? cell(r[toi]).trim() : "",
      }))
      .filter((fk) => fk.fromTable && fk.fromColumn && fk.toTable);
  }

  const fti = idx("from_table");
  const fci = idx("from_column");
  const tti = idx("to_table");
  const tci = idx("to_column");
  if (fti < 0 || tti < 0) return [];
  return rows
    .map((r) => ({
      fromTable: cell(r[fti]).trim(),
      fromColumn: fci >= 0 ? cell(r[fci]).trim() : "",
      toTable: cell(r[tti]).trim(),
      toColumn: tci >= 0 ? cell(r[tci]).trim() : "",
    }))
    .filter((fk) => fk.fromTable && fk.toTable);
}
