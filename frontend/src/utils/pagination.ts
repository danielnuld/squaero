// Engine-aware row cap for the "open table" preview SELECT.
//
// The core paginates by fetching rows and truncating (it never rewrites SQL, see
// core/src/query/materialize.c), so the cap baked into this SELECT is only an
// optimization: it stops the driver from buffering an entire (possibly huge)
// table before the core trims it. That cap must use each engine's own syntax —
// most speak `LIMIT n`, but Informix uses `SELECT FIRST n ...` (LIMIT is a
// syntax error there). Pure and unit-tested; the caller supplies the already-
// quoted, fully-qualified table reference.

import { engineFamily } from "./engineFamily";
import { qualifiedName } from "./schema";

/**
 * A capped `SELECT *` over `qualified` for a data preview, in the dialect of
 * `engine`. Informix emits `SELECT FIRST n * FROM t`; every other engine emits
 * `SELECT * FROM t LIMIT n`. `limit` is floored and treated as at least 1.
 */
export function previewSelect(qualified: string, engine: string, limit: number): string {
  const n = Math.max(1, Math.floor(limit));
  if (engineFamily(engine) === "informix") {
    return `SELECT FIRST ${n} * FROM ${qualified};`;
  }
  return `SELECT * FROM ${qualified} LIMIT ${n};`;
}

/**
 * The query that opens an object's data, capped, in the engine's own surface.
 * Relational engines get a qualified, capped SELECT (see previewSelect +
 * qualifiedName). MongoDB has no SQL surface: its driver parses
 * `db.<collection>.find(...)` with an optional chained `.limit()`, and the
 * collection is scoped by the connected database (the mongosh `db` keyword).
 */
export function objectPreviewQuery(
  parts: { db?: string; schema?: string; name: string },
  engine: string,
  limit: number,
): string {
  const n = Math.max(1, Math.floor(limit));
  if (engineFamily(engine) === "mongodb") {
    return `db.${parts.name}.find({}).limit(${n})`;
  }
  return previewSelect(qualifiedName(parts, engine), engine, n);
}
