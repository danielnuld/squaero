// The CodeMirror SQL dialect an engine's editor uses (issue: autocomplete quoted
// table names with `"` and broke MySQL).
//
// @codemirror/lang-sql quotes a completion whose name doesn't look like a plain
// lower-case identifier (`^[a-z_][a-z_\d]*$`) with the dialect's identifier
// quote, defaulting to the ANSI `"`. On MySQL `"Clientes"` is a STRING literal,
// not an identifier, so completing any table with an upper-case letter produced
// a syntax error. Handing the editor the engine's real dialect fixes the quote
// (backticks on MySQL/MariaDB) and, as a bonus, gives per-engine keywords and
// types to the highlighter.
//
// Informix has no upstream dialect: it is declared here as bare ANSI SQL with
// case-insensitive identifiers, which is what the server does (names fold to
// lower case) and — crucially — stops the completer from quoting `TABNAME`,
// since Informix rejects delimited identifiers unless DELIMIDENT is set (the
// same reason utils/schema.ts#quoteIdentifier leaves Informix names bare).

import {
  MySQL,
  MariaSQL,
  MSSQL,
  PLSQL,
  PostgreSQL,
  SQLDialect,
  SQLite,
  StandardSQL,
} from "@codemirror/lang-sql";

/** Informix: ANSI keywords, no delimited identifiers, case-insensitive names. */
const Informix = SQLDialect.define({
  caseInsensitiveIdentifiers: true,
});

/** Engine name (the driver `name`, see connections.ts) → CodeMirror dialect. */
const DIALECT: Record<string, SQLDialect> = {
  sqlite: SQLite,
  mysql: MySQL,
  mariadb: MariaSQL,
  postgres: PostgreSQL,
  postgresql: PostgreSQL,
  informix: Informix,
  oracle: PLSQL,
  sqlserver: MSSQL,
  mssql: MSSQL,
};

/**
 * Resolve an engine name to the dialect the editor should parse and complete
 * with. Unknown, absent and non-SQL engines (MongoDB) fall back to StandardSQL —
 * the editor is still a SQL editor there, we just have no better dialect.
 */
export function editorDialect(engine?: string | null): SQLDialect {
  if (!engine) return StandardSQL;
  return DIALECT[engine.toLowerCase()] ?? StandardSQL;
}

/**
 * The identifier quote the completer would apply for an engine — the observable
 * consequence of the dialect choice, exposed so it can be asserted in tests.
 * Empty string means "no quoting" is impossible in lang-sql; the engine's first
 * quote char is returned (`` ` `` for MySQL, `"` for the ANSI engines).
 */
export function completionQuote(engine?: string | null): string {
  return editorDialect(engine).spec.identifierQuotes?.[0] ?? '"';
}
