// Engine-aware, paged "open table" preview SELECT.
//
// The grid pages the preview by re-issuing this SELECT with a new offset, so the
// offset must be pushed INTO the query (the core paginates by skipping rows over
// the driver's buffered result — see core/src/query/materialize.c — which cannot
// page a query that already caps its own row count). Each engine spells the
// window in its own syntax: most use `LIMIT n OFFSET m`, Informix uses
// `SELECT SKIP m FIRST n ...` (LIMIT is a syntax error there), and MongoDB chains
// `.skip(m).limit(n)`. The row cap also bounds how much the driver buffers, so a
// huge table never streams in full for one page. Pure and unit-tested; the caller
// supplies the already-quoted, fully-qualified table reference.

import { engineFamily } from "./engineFamily";
import { qualifiedName } from "./schema";

/**
 * A paged `SELECT *` over `qualified` for a data preview, in the dialect of
 * `engine`. `limit` is floored to at least 1; `offset` is floored to at least 0.
 * Informix emits `SELECT SKIP m FIRST n * FROM t` (`SKIP m` omitted when m == 0);
 * every other engine emits `SELECT * FROM t LIMIT n OFFSET m` (`OFFSET m` omitted
 * when m == 0).
 */
export function previewSelect(
  qualified: string,
  engine: string,
  limit: number,
  offset = 0,
): string {
  const n = Math.max(1, Math.floor(limit));
  const m = Math.max(0, Math.floor(offset));
  if (engineFamily(engine) === "informix") {
    const skip = m > 0 ? `SKIP ${m} ` : "";
    return `SELECT ${skip}FIRST ${n} * FROM ${qualified};`;
  }
  const off = m > 0 ? ` OFFSET ${m}` : "";
  return `SELECT * FROM ${qualified} LIMIT ${n}${off};`;
}

/**
 * The query that opens (a page of) an object's data, in the engine's own surface.
 * Relational engines get a paged, qualified SELECT (see previewSelect +
 * qualifiedName). MongoDB has no SQL surface: its driver parses
 * `db.<collection>.find(...)` with optional chained `.skip()`/`.limit()`, and the
 * collection is scoped by the connected database (the mongosh `db` keyword).
 */
export function objectPreviewQuery(
  parts: { db?: string; schema?: string; name: string },
  engine: string,
  limit: number,
  offset = 0,
): string {
  const n = Math.max(1, Math.floor(limit));
  const m = Math.max(0, Math.floor(offset));
  if (engineFamily(engine) === "mongodb") {
    const skip = m > 0 ? `.skip(${m})` : "";
    return `db.${parts.name}.find({})${skip}.limit(${n})`;
  }
  return previewSelect(qualifiedName(parts, engine), engine, n, m);
}
