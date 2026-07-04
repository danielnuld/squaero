// Build the statement(s) that apply an edited view definition (issue #108).
// Pure and tested. The frontend never re-quotes the view's identifier itself
// (quoting is engine-specific — backticks, double quotes, or bare in Informix);
// instead it reuses the name exactly as it appears in the engine's own DDL.
//
// Strategy by engine:
//   * CREATE OR REPLACE VIEW  — where the engine supports it (MySQL/MariaDB,
//     PostgreSQL, Oracle): rewrite the leading CREATE VIEW to CREATE OR REPLACE.
//   * DROP VIEW IF EXISTS + CREATE VIEW — elsewhere (SQLite, Informix), run
//     inside a transaction so the swap is atomic.

const OR_REPLACE_ENGINES = new Set([
  "mysql",
  "mariadb",
  "postgres",
  "postgresql",
  "oracle",
]);

export type ViewApplyResult =
  | { ok: true; statements: string[] }
  | { ok: false; error: string };

/**
 * Given the target engine, the edited DDL text, and a fallback qualified name
 * (used only if the view name can't be read from the DDL), return the ordered
 * statements to execute — or an error when the text is not a CREATE … VIEW.
 */
export function buildViewApply(
  engine: string,
  ddl: string,
  fallbackName: string,
): ViewApplyResult {
  const stmt = ddl.trim().replace(/;\s*$/, "");
  if (!/^\s*create\b[\s\S]*?\bview\b/i.test(stmt)) {
    return {
      ok: false,
      error: "El texto no parece una definición de vista (CREATE … VIEW).",
    };
  }
  const e = (engine || "").toLowerCase();

  if (OR_REPLACE_ENGINES.has(e)) {
    // Already OR REPLACE (idempotent for user-edited text).
    if (/^\s*create\s+or\s+replace\b/i.test(stmt)) {
      return { ok: true, statements: [stmt] };
    }
    // Insert OR REPLACE right after the leading CREATE — NOT before VIEW. MySQL's
    // SHOW CREATE VIEW returns clauses between the two keywords
    // ("CREATE ALGORITHM=… DEFINER=… SQL SECURITY … VIEW …"), so matching
    // "CREATE VIEW" adjacently failed and the view was recreated as-is → "already
    // exists". "CREATE OR REPLACE [ALGORITHM=…] … VIEW" is the correct syntax.
    return {
      ok: true,
      statements: [stmt.replace(/^(\s*)create\b/i, "$1CREATE OR REPLACE")],
    };
  }

  // SQLite / Informix / unknown: drop then recreate (atomic under a transaction).
  const m = /create\s+view\s+(?:if\s+not\s+exists\s+)?([\s\S]+?)\s+as[\s(]/i.exec(stmt);
  const name = m ? m[1].trim() : fallbackName;
  return { ok: true, statements: [`DROP VIEW IF EXISTS ${name}`, stmt] };
}
