// Safe mode per connection (issue #666): a connection can be read-only (every
// write is refused before anything is sent) or ask for confirmation before a
// write runs. This module is the pure half: the statement classifier and the
// mode's shape. The enforcement is a single guard in the transport (transport.ts),
// which every IPC call goes through.
//
// The classifier mirrors the core's fail-closed gate (core/src/query/stmt_class.c,
// the MCP server's read-only check) so both agree on the same inputs: anything
// it cannot PROVE read-only is a write. Comments and the contents of quoted
// strings/identifiers are blanked first, under both quote-escape conventions
// (`''` doubling and `\'` backslash), and the input is split on the `;` left
// standing — so a keyword or a separator hidden in a string or a comment cannot
// smuggle a write past it, and `SELECT 1; DROP TABLE t` is a write.
//
// Decisions (documented here and in docs/IPC.md):
// - USE is read: it only switches the session's database, and the app itself
//   issues it when the working database changes (dbContext.ts).
// - SET is a write: `SET GLOBAL`, `SET PASSWORD`, `SET ROLE` cannot be told apart
//   from a harmless session variable without parsing every dialect.
// - EXPLAIN is read only when it names no write keyword: `EXPLAIN ANALYZE`
//   EXECUTES the statement it explains, so `EXPLAIN ANALYZE DELETE …` writes
//   (and a plain `EXPLAIN DELETE …` is refused too — fail-closed).
// - SELECT … INTO is a write (it creates a table, or writes a file/variable).
// - CALL/EXEC and anything unknown are writes.
// - MongoDB: only `db.<coll>.find(…)` and `db.<coll>.aggregate(…)` read; an
//   aggregate with a `$out`/`$merge` stage writes.
//
// Known ceiling: a SELECT that calls a function with side effects
// (`SELECT nextval('s')`, `SELECT pg_terminate_backend(…)`) reads as read-only —
// text alone cannot tell. The read-only DATABASE USER is the real guarantee.

export type SafeMode = "readOnly" | "confirm";
export type StmtClass = "empty" | "read" | "write";

/** How an open session is protected, as the transport guard sees it. */
export interface SafeModeGuard {
  mode: SafeMode;
  /** Driver name: MongoDB is classified by its own (mongosh) rules. */
  engine: string;
  /** The connection's display name, for the messages. */
  name: string;
}

/** The guard for a saved connection, or null when it is unprotected. */
export function guardFor(c: { safeMode?: SafeMode; driver: string; name: string }): SafeModeGuard | null {
  return c.safeMode ? { mode: c.safeMode, engine: c.driver, name: c.name } : null;
}

/** The stored value, or undefined for anything that is not a known mode. */
export function parseSafeMode(v: unknown): SafeMode | undefined {
  return v === "readOnly" || v === "confirm" ? v : undefined;
}

// Leaders of a provably read-only statement (WITH, EXPLAIN and SELECT are scanned).
const READ_LEADERS = new Set(["SHOW", "DESCRIBE", "DESC", "VALUES", "TABLE", "USE"]);

// Whole words that make a WITH/EXPLAIN statement a write. A superset, on purpose.
const WRITE_TOKENS = new Set([
  "INSERT", "UPDATE", "DELETE", "MERGE", "CREATE", "DROP", "ALTER", "TRUNCATE",
  "REPLACE", "GRANT", "REVOKE", "CALL", "EXEC", "EXECUTE", "SET", "LOCK", "UNLOCK",
  "RENAME", "COMMENT", "ATTACH", "DETACH", "VACUUM", "REINDEX", "COPY", "LOAD",
  "PRAGMA", "UPSERT", "IMPORT", "INTO",
]);

/** Blank comments and string/identifier contents, keeping the delimiters. */
function normalize(sql: string, backslashEscapes: boolean): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) { out += " "; i++; }
      if (i < n) { out += "  "; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      out += c;
      i++;
      while (i < n) {
        if (backslashEscapes && sql[i] === "\\" && i + 1 < n) { out += "  "; i += 2; continue; }
        if (sql[i] === c) {
          if (sql[i + 1] === c) { out += "  "; i += 2; continue; }
          out += c;
          i++;
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const words = (s: string): string[] => s.toUpperCase().match(/[A-Z_]+/g) ?? [];

function classifyStatement(s: string): StmtClass {
  const body = s.replace(/^[\s(]+/, "");
  if (body === "") return "empty";
  const lead = /^[A-Za-z_]+/.exec(body)?.[0].toUpperCase();
  if (!lead) return "write"; // starts with something non-alphabetic
  if (lead === "WITH" || lead === "EXPLAIN") {
    return words(body).some((w) => WRITE_TOKENS.has(w)) ? "write" : "read";
  }
  if (lead === "SELECT") return words(body).includes("INTO") ? "write" : "read";
  return READ_LEADERS.has(lead) ? "read" : "write";
}

function classifyNormalized(norm: string): StmtClass {
  let overall: StmtClass = "empty";
  for (const part of norm.split(";")) {
    const c = classifyStatement(part);
    if (c === "write") return "write";
    if (c === "read") overall = "read";
  }
  return overall;
}

/** mongosh surface: only find/aggregate read; `$out`/`$merge` write. */
function classifyMongo(text: string): StmtClass {
  let overall: StmtClass = "empty";
  // Naive split: a `;` inside a string yields a fragment that is not `db.…`,
  // which reads as a write — a false positive, never a false negative.
  for (const raw of text.split(";")) {
    const part = raw.trim();
    if (part === "") continue;
    const m = /^db\.(.+?)\.([A-Za-z]+)\s*\(/.exec(part);
    if (!m) return "write";
    // The driver takes the method as the identifier before the FIRST '('.
    const method = /([A-Za-z]+)\s*$/.exec(part.slice(0, part.indexOf("(")))?.[1];
    if (method === "find") overall = "read";
    else if (method === "aggregate" && !/\$(out|merge)\b/.test(part)) overall = "read";
    else return "write";
  }
  return overall;
}

/**
 * Classify a (possibly multi-statement) input: "write" if any statement writes
 * or cannot be proven read-only, "read" only when every one reads, "empty" when
 * there is nothing to run.
 */
export function classifySql(sql: string, engine?: string): StmtClass {
  if (!sql) return "empty";
  if ((engine ?? "").toLowerCase() === "mongodb") return classifyMongo(sql);
  let combined: StmtClass = "empty";
  for (const mode of [false, true]) {
    const c = classifyNormalized(normalize(sql, mode));
    if (c === "write") return "write";
    if (c === "read") combined = "read";
  }
  return combined;
}

/** The statements of a script that write, for the confirmation to list. */
export function writeStatements(stmts: string[], engine?: string): string[] {
  return stmts.filter((s) => classifySql(s, engine) === "write");
}

/**
 * The writes as the confirmation shows them: one per paragraph, each ending in
 * `;`. Past `max` the rest is counted, not printed — a restore of thousands of
 * INSERTs must not build a dialog the size of the file.
 */
export function confirmListing(writes: string[], max = 50): string {
  const shown = writes.slice(0, max).map((w) => w.trim().replace(/;+\s*$/, "") + ";");
  if (writes.length > max) shown.push(`… (+${writes.length - max})`);
  return shown.join("\n\n");
}
