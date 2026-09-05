// The DROP behind the tree's "Eliminar…" (issue #463).
//
// Deleting an object was the one thing the tree could not do: the menu opened
// its data, its structure, its definition — and then you wrote the DROP by hand
// in a query tab, spelling the qualification yourself.
//
// Pure so the destructive statement is unit-tested and shown to the user
// verbatim before it runs (the confirmation dialog prints exactly this text).

import { engineFamily } from "./engineFamily";
import { qualifiedName, quoteIdentifier } from "./schema";

/** What is being dropped. Maps 1:1 to the DROP keyword. */
export type DropKind = "table" | "view" | "procedure" | "function" | "trigger" | "event";

export interface DropTarget {
  kind: DropKind;
  name: string;
  db?: string;
  schema?: string;
  /** The table a trigger hangs off; PostgreSQL cannot drop one without it. */
  table?: string;
}

/**
 * The DROP for one tree object, or null when this engine cannot drop that kind
 * of thing — in which case the menu entry is not offered at all, rather than
 * offering a statement that will fail (honest capabilities, AGENTS.md §6).
 *
 * No `IF EXISTS`: the object was picked from the tree, so if it is already gone
 * the engine's own error is the useful answer.
 *
 * ponytail: an overloaded routine (PostgreSQL, Informix) needs its argument
 * types — or DROP SPECIFIC — to be identified; the drop then fails and says so,
 * which beats guessing a signature the tree never listed.
 */
export function dropObjectSql(engine: string, target: DropTarget): string | null {
  const family = engineFamily(engine);
  const { kind } = target;
  // MongoDB has no SQL DDL at all; SQLite has no routines; only MySQL/MariaDB
  // has scheduled events.
  if (family === "mongodb") return null;
  if (family === "sqlite" && (kind === "procedure" || kind === "function")) return null;
  if (kind === "event" && family !== "mysql") return null;

  // A routine or trigger is qualified by its database/schema, never by the
  // table it belongs to; Informix takes the bare name (its connection already
  // names the database, and an owner-qualified reference stalls some servers).
  const qualify = (n: string) =>
    family === "informix"
      ? quoteIdentifier(n, engine)
      : qualifiedName({ db: target.db, schema: target.schema, name: n }, engine);
  const name = qualify(target.name);

  if (kind === "trigger" && family === "postgres") {
    if (!target.table) return null; // PostgreSQL drops a trigger by its table
    // The TABLE carries the qualification there, never the trigger name.
    return `DROP TRIGGER ${quoteIdentifier(target.name, engine)} ON ${qualify(target.table)}`;
  }
  return `DROP ${kind.toUpperCase()} ${name}`;
}
