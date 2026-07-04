// Active-database context helper. Choosing a working database scopes the ER
// diagram and query builder to it and, on engines that support switching the
// session's default database, sets it so unqualified queries in the editor run
// against the right database. Pure and unit-tested; the component runs the SQL.

/**
 * The statement that switches the session's default database, or null when the
 * engine can't switch mid-session. MySQL/MariaDB use `USE`; SQLite is a single
 * database, MongoDB's database is fixed at connect, Informix connects per
 * database, and PostgreSQL needs a reconnect — all null (scoping still applies
 * in the tools).
 */
export function useDatabaseSql(engine: string, db: string): string | null {
  if (!db.trim()) return null;
  const e = engine.toLowerCase();
  if (e === "mysql" || e === "mariadb") {
    return "USE `" + db.replace(/`/g, "``") + "`";
  }
  return null;
}
