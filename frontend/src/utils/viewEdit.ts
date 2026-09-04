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
  // The definition is now SHOWN in its runnable form (issue #454), so on the
  // engines without OR REPLACE an edited draft comes back carrying the leading
  // DROP. Work from the CREATE — the drop is regenerated below for the engines
  // that need it, and would otherwise be duplicated or read as "not a view".
  const stmt = ddl
    .trim()
    .replace(/^drop\s+view\s+(?:if\s+exists\s+)?[^;]*;\s*/i, "")
    .trim()
    .replace(/;\s*$/, "");
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

/**
 * The definition as the user should SEE it: runnable as it stands (issue #454).
 *
 * What the engine hands back — `SHOW CREATE VIEW` and friends — is a plain
 * `CREATE … VIEW`, which cannot run against a view that already exists: MySQL
 * answers `1050 Table 'v' already exists`. The rewrite existed but only inside
 * the Aplicar button, so the moment the text was copied into a query tab the
 * error came back. Same rule, applied to the text on screen.
 *
 * Statements are separated by `;` and the last one carries it too, so the text
 * can be copied straight into the editor and run (a script runs statement by
 * statement — issues #441 and #452). Text that is not a view definition is
 * returned untouched: showing it is still better than showing nothing.
 */
export function runnableViewDdl(engine: string, ddl: string, fallbackName: string): string {
  const plan = buildViewApply(engine, ddl, fallbackName);
  return plan.ok ? `${plan.statements.join(";\n\n")};` : ddl;
}
