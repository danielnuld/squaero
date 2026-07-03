// Pretty-print SQL in the editor (issue #106). Thin, tested wrapper over
// sql-formatter: it picks the dialect from the active engine, never loses the
// user's text (returns the original on any error), and refuses to touch a
// non-SQL engine's query (MongoDB uses mongosh syntax, not SQL).

import { format, type SqlLanguage } from "sql-formatter";

// Engine name (the driver `name`, see connections.ts) → sql-formatter language.
const LANGUAGE: Record<string, SqlLanguage> = {
  sqlite: "sqlite",
  mysql: "mysql",
  mariadb: "mariadb",
  postgres: "postgresql",
  postgresql: "postgresql",
  informix: "db2", // no Informix dialect upstream; DB2 is the closest SQL-92 fit
  oracle: "plsql",
  sqlserver: "tsql",
  mssql: "tsql",
};

/**
 * Resolve an engine name to a formatter dialect. Returns null for engines whose
 * query language is NOT SQL (so the caller leaves the text untouched), and the
 * generic "sql" dialect when the engine is unknown or absent.
 */
export function dialectFor(engine?: string | null): SqlLanguage | null {
  if (!engine) return "sql";
  const e = engine.toLowerCase();
  if (e === "mongodb") return null; // mongosh, not SQL — never reformat as SQL
  return LANGUAGE[e] ?? "sql";
}

/**
 * Format `sql` for the given engine. Idempotent-friendly and total: an empty or
 * whitespace-only input, a non-SQL engine, or a formatter error all return the
 * input unchanged, so the action can never destroy what the user typed.
 */
export function formatSql(sql: string, engine?: string | null): string {
  const language = dialectFor(engine);
  if (language === null) return sql;
  if (sql.trim() === "") return sql;
  try {
    return format(sql, { language, keywordCase: "upper" });
  } catch {
    return sql;
  }
}
