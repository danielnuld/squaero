// Backup and restore of a database, phase 1 (issue #143): a plain SQL dump —
// each object's CREATE statement plus one INSERT per row — and restoring by
// running such a file statement by statement. Engine-native tools (mysqldump,
// pg_dump, dbexport) are a later phase.
//
// Client-side, like export and transfer (docs/IPC.md, M8/M9 decision): the
// structure comes from schema.ddl, the rows from query.run's cursor. This module
// only shapes text and orders work; the component injects the IPC calls, so the
// whole thing is testable without a core.

import type { ResultSet } from "./query";
import { quoteIdentifier } from "./schema";
import { splitStatements } from "./runScope";
import { engineFamily } from "./engineFamily";

/** One object to dump, as the object tree lists it. */
export interface DumpObject {
  name: string;
  kind: "table" | "view";
}

/** Where the dump reads from. */
export interface DumpSource {
  /** The object's CREATE statement. */
  ddl: (name: string) => Promise<string>;
  /** Every row of a table. */
  rows: (name: string) => Promise<ResultSet>;
}

export interface DumpOptions {
  structure: boolean;
  data: boolean;
}

/** INSERT statements per yielded piece: a table never becomes one huge string. */
const ROWS_PER_PIECE = 500;

/** A CREATE statement ending in exactly one semicolon, whatever the engine sent. */
export function ddlStatement(ddl: string): string {
  return ddl.trim().replace(/[;\s]+$/, "") + ";";
}

/**
 * A string literal for `engine`. Quotes are doubled everywhere; MySQL also reads
 * a backslash as an escape by default, so a backslash is doubled there too —
 * otherwise `C:\new` would come back as `C:` + newline + `ew`.
 */
export function sqlLiteral(value: string | null, engine: string): string {
  if (value === null) return "NULL";
  let v = value.replace(/'/g, "''");
  if (engineFamily(engine) === "mysql") v = v.replace(/\\/g, "\\\\");
  return `'${v}'`;
}

/** One INSERT per row. Values go as literals and the engine coerces them, as
    in the row.* edit path. */
export function insertStatements(table: string, result: ResultSet, engine: string): string[] {
  const cols = result.columns.map((c) => quoteIdentifier(c.name, engine)).join(", ");
  const head = `INSERT INTO ${quoteIdentifier(table, engine)} (${cols}) VALUES (`;
  return result.rows.map(
    (row) => head + result.columns.map((_, i) => sqlLiteral(row[i] ?? null, engine)).join(", ") + ");",
  );
}

/**
 * The dump, in pieces for a writer that streams to disk. Order: every table's
 * CREATE, then every table's rows, then the views — a view can only be created
 * once the tables it reads exist.
 *
 * ponytail: tables are not ordered by foreign key. MySQL gets its checks switched
 * off around the dump; on other engines a restore can trip over a reference whose
 * target has not been filled yet. Sort by FK when that bites.
 *
 * `onObject` reports which object is being read, for the progress line.
 */
export async function* dumpChunks(
  src: DumpSource,
  objects: DumpObject[],
  engine: string,
  opts: DumpOptions,
  onObject?: (name: string) => void,
): AsyncGenerator<string> {
  const tables = objects.filter((o) => o.kind === "table");
  const views = objects.filter((o) => o.kind === "view");
  const mysql = engineFamily(engine) === "mysql";
  if (mysql) yield "SET FOREIGN_KEY_CHECKS=0;\n";
  if (opts.structure) {
    for (const t of tables) {
      onObject?.(t.name);
      yield `\n-- ${t.name}\n${ddlStatement(await src.ddl(t.name))}\n`;
    }
  }
  if (opts.data) {
    for (const t of tables) {
      onObject?.(t.name);
      const inserts = insertStatements(t.name, await src.rows(t.name), engine);
      if (inserts.length === 0) continue;
      yield `\n-- ${t.name}: ${inserts.length}\n`;
      for (let i = 0; i < inserts.length; i += ROWS_PER_PIECE) {
        yield inserts.slice(i, i + ROWS_PER_PIECE).join("\n") + "\n";
      }
    }
  }
  if (opts.structure) {
    for (const v of views) {
      onObject?.(v.name);
      yield `\n-- ${v.name}\n${ddlStatement(await src.ddl(v.name))}\n`;
    }
  }
  if (mysql) yield "\nSET FOREIGN_KEY_CHECKS=1;\n";
}

/** True when a piece of SQL is nothing but comments and whitespace. */
function onlyComments(sql: string): boolean {
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "").trim() === "";
}

/** The statements of a script to restore, in order, without empty pieces. */
export function restoreStatements(sql: string, engine: string): string[] {
  return splitStatements(sql, engine)
    .map((s) => s.text.trim())
    .filter((s) => !onlyComments(s));
}

export interface RestoreReport {
  /** Statements that ran successfully. */
  ran: number;
  total: number;
  /** The first statement that failed (1-based), when one did. Restore stops there. */
  failed?: { index: number; statement: string; error: unknown };
}

/**
 * Runs the statements in order and stops at the first failure. Not in a
 * transaction: most engines commit DDL on their own, so a rollback would promise
 * something it cannot keep. The report says how far it got.
 */
export async function runRestore(
  statements: string[],
  run: (sql: string) => Promise<unknown>,
  onProgress?: (done: number) => void,
): Promise<RestoreReport> {
  for (let i = 0; i < statements.length; i++) {
    try {
      await run(statements[i]);
    } catch (error) {
      return {
        ran: i,
        total: statements.length,
        failed: { index: i + 1, statement: statements[i], error },
      };
    }
    onProgress?.(i + 1);
  }
  return { ran: statements.length, total: statements.length };
}
