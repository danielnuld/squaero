// A routine's definition as the user should SEE it: runnable as it stands
// (issue #456), the same rule views got in #454.
//
// What the catalogs hand back — SHOW CREATE PROCEDURE, pg_get_functiondef,
// systrigbody, sqlite_master.sql — is a plain CREATE, and running it against the
// routine that already exists answers "1304 PROCEDURE already exists" (MySQL),
// "-9793 Routine already exists" (Informix) or the like. So the one thing the
// panel offers ("abrir en editor") produced text that could not be run.
//
// Pure: the explorers pass the text in and show what comes out.

import { engineFamily } from "./engineFamily";

/** What the DDL creates; drives both the DROP and the OR REPLACE. */
export type RoutineKind = "procedure" | "function" | "trigger" | "event";

/** `CREATE [OR REPLACE] [DEFINER=…] <kind> <name>`, however the engine spells it. */
const HEAD =
  /^\s*create\s+(?:or\s+replace\s+)?(?:definer\s*=\s*\S+\s+)?(procedure|function|trigger|event)\s+([^\s(]+)/i;

/** The table a trigger hangs off, which PostgreSQL needs in order to drop it. */
const TRIGGER_TABLE = /\bon\s+([^\s(]+)/i;

/**
 * Rewrite a routine definition into the form that can be re-executed.
 *
 * Three shapes, by what the engine actually supports:
 *   - Already `CREATE OR REPLACE` (PostgreSQL functions come back that way):
 *     left alone, it is already runnable.
 *   - The engine has OR REPLACE for this kind (PostgreSQL functions and
 *     procedures, Oracle): the word is inserted after CREATE.
 *   - Everything else (MySQL/MariaDB, Informix, SQLite triggers, PostgreSQL
 *     triggers): `DROP … IF EXISTS` before the CREATE. Both statements are
 *     terminated by `;` so the text runs as it reads — a script goes to the
 *     engine statement by statement (#441) and a routine body survives the split
 *     (#456).
 *
 * Text that does not parse as a routine header is returned untouched: showing it
 * is still better than showing nothing.
 *
 * ponytail: an overloaded Informix routine cannot be dropped by name alone
 * (DROP SPECIFIC PROCEDURE is the way); the drop then fails and the user edits
 * one line, which beats guessing a specific name from a definition.
 */
export function runnableRoutineDdl(engine: string, ddl: string, fallbackName: string): string {
  const stmt = ddl.trim().replace(/;\s*$/, "");
  const m = HEAD.exec(stmt);
  if (!m) return ddl;
  const kind = m[1].toLowerCase() as RoutineKind;
  const name = m[2] || fallbackName;
  const family = engineFamily(engine);

  if (/^\s*create\s+or\s+replace\b/i.test(stmt)) return `${stmt};`;

  const orReplace =
    family === "oracle" ||
    (family === "postgres" && (kind === "procedure" || kind === "function"));
  if (orReplace) return `${stmt.replace(/^\s*create\b/i, "CREATE OR REPLACE")};`;

  // PostgreSQL drops a trigger by table, not by name alone.
  const table = kind === "trigger" ? TRIGGER_TABLE.exec(stmt.slice(m[0].length))?.[1] : undefined;
  const drop =
    family === "postgres" && kind === "trigger" && table
      ? `DROP TRIGGER IF EXISTS ${name} ON ${table}`
      : `DROP ${kind.toUpperCase()} IF EXISTS ${name}`;
  return `${drop};\n\n${stmt};`;
}
