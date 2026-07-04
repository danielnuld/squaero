// Build the EXPLAIN statement for the active engine (issue #131). Returns null
// for engines without an inline, result-returning EXPLAIN: Informix writes the
// plan to a file (SET EXPLAIN ON) rather than returning rows, and MongoDB uses a
// different `.explain()` surface — both out of scope for this SQL helper. The
// query's trailing semicolon is stripped so the EXPLAIN prefix stays valid.

const TRAILING_SEMI = /;\s*$/;

export function buildExplain(engine: string, sql: string): string | null {
  const e = (engine || "").toLowerCase();
  const q = sql.trim().replace(TRAILING_SEMI, "");
  if (!q) return null;
  switch (e) {
    case "sqlite":
      // Plain EXPLAIN returns VM bytecode; QUERY PLAN is the human-readable plan.
      return `EXPLAIN QUERY PLAN ${q}`;
    case "mysql":
    case "mariadb":
    case "postgres":
    case "postgresql":
      return `EXPLAIN ${q}`;
    default:
      return null;
  }
}

/** Whether the engine supports an inline, result-returning EXPLAIN. */
export function explainSupported(engine: string): boolean {
  return buildExplain(engine, "SELECT 1") !== null;
}
