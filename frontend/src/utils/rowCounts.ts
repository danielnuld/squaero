// Row counts beside the tables of the tree and the connected home (R-35): read
// from the engine's catalog in ONE statement per level, never a COUNT(*) per
// table — on a large schema that would be thousands of full scans. Catalog
// numbers are statistics (an estimate on MySQL/InnoDB, PostgreSQL, Informix);
// SQLite and MongoDB keep none queryable, so they show no count rather than a
// made-up one. Pure.

import { engineFamily } from "./engineFamily";
import { quoteIdentifier } from "./schema";

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The catalog query answering `name, n` for the tables of one level, or null
    when the engine keeps no counts. */
export function rowCountSql(engine: string, db?: string, schema?: string): string | null {
  switch (engineFamily(engine)) {
    case "mysql":
      return (
        "SELECT TABLE_NAME AS name, TABLE_ROWS AS n FROM information_schema.TABLES " +
        `WHERE TABLE_SCHEMA = ${db ? lit(db.replace(/\\/g, "\\\\")) : "DATABASE()"} AND TABLE_TYPE = 'BASE TABLE'`
      );
    case "postgres":
      return (
        "SELECT c.relname AS name, c.reltuples::bigint AS n FROM pg_class c " +
        "JOIN pg_namespace s ON s.oid = c.relnamespace " +
        `WHERE c.relkind IN ('r', 'p') AND s.nspname = ${lit(schema ?? "public")}`
      );
    case "mssql": {
      const sys = db ? `${quoteIdentifier(db, "mssql")}.sys` : "sys";
      return (
        `SELECT t.name AS name, SUM(p.rows) AS n FROM ${sys}.tables t ` +
        `JOIN ${sys}.schemas s ON s.schema_id = t.schema_id ` +
        `JOIN ${sys}.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1) ` +
        `WHERE s.name = ${lit(schema ?? "dbo")} GROUP BY t.name`
      );
    }
    case "informix":
      return (
        `SELECT tabname AS name, nrows AS n FROM ${db ? `${db}:` : ""}systables ` +
        "WHERE tabtype = 'T' AND tabid >= 100"
      );
    default:
      return null;
  }
}

/** Name → rows from the catalog answer. A negative or non-numeric count (a
    PostgreSQL table never analysed reports -1) is left out: unknown, not zero. */
export function parseRowCounts(
  columns: { name: string }[],
  rows: (string | null)[][],
): Record<string, number> {
  const ni = columns.findIndex((c) => c.name.toLowerCase() === "name");
  const ci = columns.findIndex((c) => c.name.toLowerCase() === "n");
  const out: Record<string, number> = {};
  if (ni < 0 || ci < 0) return out;
  for (const r of rows) {
    const name = (r[ni] ?? "").trim();
    const n = Number(r[ci]);
    if (name && r[ci] !== null && Number.isFinite(n) && n >= 0) out[name] = Math.round(n);
  }
  return out;
}
