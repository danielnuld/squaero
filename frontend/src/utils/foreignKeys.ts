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
//   SQLite        — pragma_foreign_key_list as a table-valued function joined to
//                   sqlite_master, so the per-table PRAGMA becomes one query and
//                   can also answer the inbound direction (SQLite >= 3.16).
//   Informix      — sysconstraints (constrtype='R') + sysreferences, resolving
//                   every column of the local/referenced index over sysindexes
//                   part1..part16 (Informix has no unpivot, hence a UNION ALL per
//                   position; `utils/indexes.ts` still carries the old part1-only
//                   limitation).
//   MongoDB       — no foreign keys; honestly unsupported (falls back to naming).
//
// Every engine aliases its output to a single shape (from_table, from_column,
// to_table, to_column, constraint_name, position) so parseForeignKeys reads them
// engine-agnostically, and groupForeignKeys turns those pairs into whole keys.
// Everything here is pure and unit-tested.

import { engineFamily as family } from "./engineFamily";

/** One resolved foreign-key column pair: fromTable.fromColumn -> toTable.toColumn. */
export interface ForeignKey {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  /** Identity of the constraint this pair belongs to (its name, or the PRAGMA id
      on SQLite). Groups the pairs of a composite key — see groupForeignKeys. */
  constraint?: string;
  /** 1-based position of this pair inside its constraint, so a composite key
      keeps the order the catalog declares. */
  position?: number;
}

/** A whole foreign key: one constraint with every column pair it spans. */
export interface ForeignKeyRelation {
  /** The table that holds the foreign key (the dependent one). */
  fromTable: string;
  /** The table being referenced. */
  toTable: string;
  /** Constraint identity, unique within `fromTable`. */
  constraint: string;
  /** Column pairs in catalog order: fromTable.from references toTable.to. */
  columns: { from: string; to: string }[];
}

/** Which side of the relationship a scope narrows. */
export type FkDirection = "from" | "to";

/**
 * Narrows a FK query to ONE table: `from` keeps the keys that leave it (the
 * value picker of an edit session), `to` the keys that point AT it (its
 * dependents — the related-data modal). Whole-database listings (the ER diagram)
 * pass no scope: query.run caps the rows it returns, and a schema with thousands
 * of foreign keys silently loses the tail.
 */
export interface FkScope {
  table: string;
  direction: FkDirection;
}

/** How to obtain an engine's foreign keys (or why we can't). */
export interface ForeignKeyQuery {
  /** The engine exposes FK metadata we can query. */
  supported: boolean;
  /** The query returning the foreign keys in scope (null when unsupported). */
  bulkSql: string | null;
  /** Honest reason shown when unsupported. */
  reason: string | null;
}

/** The sixteen key positions Informix indexes expose (part1..part16). */
const INFORMIX_KEY_PARTS = Array.from({ length: 16 }, (_, i) => i + 1);

/** Standard SQL string literal: double embedded single quotes. PostgreSQL,
    SQLite and Informix treat backslash as an ordinary character, so nothing else
    is needed there. */
const lit = (s: string) => s.replace(/'/g, "''");

/** MySQL/MariaDB literal: its default sql_mode treats backslash as an escape
    character, so double backslashes too (before quotes). */
const litMy = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "''");

const unsupported = (reason: string): ForeignKeyQuery => ({
  supported: false,
  bulkSql: null,
  reason,
});

/**
 * The FK-query plan for an engine. `db` scopes the catalog to the working
 * database/schema; engines already scoped to one database (SQLite) ignore it.
 *
 * `scope` narrows the answer to ONE table, on either side of the relationship
 * (see FkScope). A whole-database FK listing is not just wasteful, it is unsafe
 * to rely on — query.run caps the rows it returns (IPC_QUERY_DEFAULT_LIMIT), and
 * a schema with a few thousand foreign keys silently loses the tail, so the table
 * you cared about may simply not be in the answer. The ER diagram, which
 * genuinely wants them all, omits it.
 */
export function foreignKeysFor(engine: string, db?: string, scope?: FkScope): ForeignKeyQuery {
  const dbName = (db ?? "").trim();
  const only = (scope?.table ?? "").trim();
  const inbound = scope?.direction === "to";
  switch (family(engine)) {
    case "mysql": {
      const dbScope = dbName ? `'${litMy(dbName)}'` : "DATABASE()";
      const col = inbound ? "REFERENCED_TABLE_NAME" : "TABLE_NAME";
      const tableScope = only ? ` AND ${col} = '${litMy(only)}'` : "";
      return {
        supported: true,
        bulkSql:
          "SELECT TABLE_NAME AS from_table, COLUMN_NAME AS from_column, " +
          "REFERENCED_TABLE_NAME AS to_table, REFERENCED_COLUMN_NAME AS to_column, " +
          "CONSTRAINT_NAME AS constraint_name, ORDINAL_POSITION AS position " +
          "FROM information_schema.KEY_COLUMN_USAGE " +
          `WHERE TABLE_SCHEMA = ${dbScope} AND REFERENCED_TABLE_NAME IS NOT NULL${tableScope} ` +
          "ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
        reason: null,
      };
    }
    case "postgres": {
      // Unnest conkey/confkey together so column i of the FK pairs with column i
      // of the referenced key (keeps composite FKs ordered and correctly paired).
      const nsScope = dbName
        ? `n.nspname = '${lit(dbName)}'`
        : "n.nspname NOT IN ('pg_catalog', 'information_schema')";
      const tableScope = only
        ? ` AND ${inbound ? "cf.relname" : "cl.relname"} = '${lit(only)}'`
        : "";
      return {
        supported: true,
        bulkSql:
          "SELECT cl.relname AS from_table, a.attname AS from_column, " +
          "cf.relname AS to_table, af.attname AS to_column, " +
          "con.conname AS constraint_name, k.i AS position " +
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
    case "informix": {
      // sysindexes stores the key columns as sixteen flat columns (part1..part16),
      // and Informix has no unpivot, so the query is a UNION ALL of one branch per
      // position. Verbose but generated once, and it beats sixteen round trips.
      // Parts are negative for descending index columns, hence ABS().
      const scoped = only
        ? `AND ${inbound ? "pt.tabname" : "t.tabname"} = '${lit(only)}' `
        : "";
      const branch = (n: number) =>
        "SELECT TRIM(t.tabname) AS from_table, TRIM(fc.colname) AS from_column, " +
        "TRIM(pt.tabname) AS to_table, TRIM(pc.colname) AS to_column, " +
        `TRIM(c.constrname) AS constraint_name, ${n} AS position ` +
        "FROM sysconstraints c " +
        "JOIN systables t ON t.tabid = c.tabid " +
        "JOIN sysreferences r ON r.constrid = c.constrid " +
        "JOIN systables pt ON pt.tabid = r.ptabid " +
        "JOIN sysindexes fi ON fi.idxname = c.idxname AND fi.tabid = c.tabid " +
        `JOIN syscolumns fc ON fc.tabid = c.tabid AND fc.colno = ABS(fi.part${n}) ` +
        "JOIN sysconstraints pk ON pk.constrid = r.primary " +
        "JOIN sysindexes pi ON pi.idxname = pk.idxname AND pi.tabid = pk.tabid " +
        `JOIN syscolumns pc ON pc.tabid = pk.tabid AND pc.colno = ABS(pi.part${n}) ` +
        "WHERE c.constrtype = 'R' AND t.tabid > 99 " +
        `AND fi.part${n} <> 0 AND pi.part${n} <> 0 ` +
        scoped;
      return {
        supported: true,
        bulkSql:
          INFORMIX_KEY_PARTS.map(branch).join("UNION ALL ") +
          "ORDER BY 1, 5, 6",
        reason: null,
      };
    }
    case "sqlite": {
      // pragma_foreign_key_list as a table-valued function (SQLite >= 3.16) turns
      // the per-table PRAGMA into one query, which also gives us the inbound
      // direction the PRAGMA alone cannot answer.
      const tableScope = only
        ? ` AND ${inbound ? 'f."table"' : "m.name"} = '${lit(only)}' COLLATE NOCASE`
        : "";
      return {
        supported: true,
        bulkSql:
          'SELECT m.name AS from_table, f."from" AS from_column, ' +
          'f."table" AS to_table, f."to" AS to_column, ' +
          "f.id AS constraint_name, f.seq AS position " +
          "FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f " +
          `WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'${tableScope} ` +
          "ORDER BY m.name, f.id, f.seq",
        reason: null,
      };
    }
    case "mongodb":
      return unsupported("MongoDB no tiene llaves foráneas; se usan relaciones inferidas por nombre.");
    default:
      return unsupported("Este motor no expone llaves foráneas en catálogos.");
  }
}

const cell = (v: string | null | undefined): string => (v === null || v === undefined ? "" : String(v));

/**
 * Parse a FK-query result into ForeignKey[]. Every engine aliases its catalog to
 * the same output columns, so this reads them by name. Rows missing a source
 * column or referenced table are dropped (defensive against odd catalogs).
 */
export function parseForeignKeys(
  columns: { name: string }[],
  rows: (string | null)[][],
): ForeignKey[] {
  const idx = (name: string) => columns.findIndex((c) => c.name.toLowerCase() === name);
  const fti = idx("from_table");
  const fci = idx("from_column");
  const tti = idx("to_table");
  const tci = idx("to_column");
  const cni = idx("constraint_name");
  const pi = idx("position");
  if (fti < 0 || tti < 0) return [];
  return rows
    .map((r) => {
      const fk: ForeignKey = {
        fromTable: cell(r[fti]).trim(),
        fromColumn: fci >= 0 ? cell(r[fci]).trim() : "",
        toTable: cell(r[tti]).trim(),
        toColumn: tci >= 0 ? cell(r[tci]).trim() : "",
      };
      const constraint = cni >= 0 ? cell(r[cni]).trim() : "";
      if (constraint) fk.constraint = constraint;
      const position = pi >= 0 ? Number(cell(r[pi])) : NaN;
      if (Number.isFinite(position)) fk.position = position;
      return fk;
    })
    .filter((fk) => fk.fromTable && fk.toTable);
}

/**
 * Groups column pairs into whole foreign keys: one entry per constraint, with
 * its columns in catalog order. A composite key therefore travels complete
 * instead of as loose pairs — which is what a dependent-row filter needs.
 *
 * Pairs are keyed by (fromTable, constraint) because a constraint name is only
 * unique within its table, and SQLite's identity is a per-table PRAGMA id. When
 * the catalog gave no constraint (older callers), the target table stands in, so
 * grouping degrades to the previous "one relationship per table pair" behaviour
 * instead of losing rows.
 */
export function groupForeignKeys(fks: ForeignKey[]): ForeignKeyRelation[] {
  const byKey = new Map<string, { rel: ForeignKeyRelation; at: number[] }>();
  const order: string[] = [];
  fks.forEach((fk, i) => {
    const constraint = fk.constraint ?? fk.toTable;
    const key = `${fk.fromTable} ${constraint}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        rel: { fromTable: fk.fromTable, toTable: fk.toTable, constraint, columns: [] },
        at: [],
      };
      byKey.set(key, entry);
      order.push(key);
    }
    entry.rel.columns.push({ from: fk.fromColumn, to: fk.toColumn });
    // Fall back to row order when the catalog reported no position.
    entry.at.push(fk.position ?? i);
  });
  return order.map((key) => {
    const { rel, at } = byKey.get(key)!;
    rel.columns = rel.columns
      .map((c, i) => ({ c, at: at[i] }))
      .sort((a, b) => a.at - b.at)
      .map((x) => x.c);
    return rel;
  });
}
