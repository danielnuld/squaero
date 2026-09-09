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

/** The WHERE and ORDER BY bodies (no keywords) a preview is narrowed with. */
export interface PreviewFilter {
  where?: string;
  orderBy?: string;
}

/**
 * A paged `SELECT *` over `qualified` for a data preview, in the dialect of
 * `engine`. `limit` <= 0 means NO cap at all — the whole object, which is what an
 * export reads (issue #479); anything else is floored to at least 1. `offset` is
 * floored to at least 0.
 * Informix emits `SELECT SKIP m FIRST n * FROM t` (`SKIP m` omitted when m == 0);
 * every other engine emits `SELECT * FROM t LIMIT n OFFSET m` (`OFFSET m` omitted
 * when m == 0).
 */
export function previewSelect(
  qualified: string,
  engine: string,
  limit: number,
  offset = 0,
  where?: string,
  orderBy?: string,
): string {
  const n = Math.floor(limit);
  const m = Math.max(0, Math.floor(offset));
  const filter = where ? ` WHERE ${where}` : "";
  // ORDER BY has to be part of the paged query, not applied to the page: sorting
  // the rows that came back reorders an arbitrary sample, which is exactly the
  // caveat the grid has been printing under every truncated result (issue #347).
  const order = orderBy ? ` ORDER BY ${orderBy}` : "";
  if (engineFamily(engine) === "informix") {
    const skip = m > 0 ? `SKIP ${m} ` : "";
    const first = n >= 1 ? `FIRST ${n} ` : "";
    return `SELECT ${skip}${first}* FROM ${qualified}${filter}${order};`;
  }
  const off = m > 0 ? ` OFFSET ${m}` : "";
  if (n < 1) {
    // No LIMIT to hang the OFFSET on; an export reads the object whole anyway.
    return `SELECT * FROM ${qualified}${filter}${order};`;
  }
  return `SELECT * FROM ${qualified}${filter}${order} LIMIT ${n}${off};`;
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
  filter?: PreviewFilter,
): string {
  const n = Math.floor(limit);
  const m = Math.max(0, Math.floor(offset));
  if (engineFamily(engine) === "mongodb") {
    // No filter is threaded here on purpose: a Mongo preview is find({}), not a
    // SELECT, and the panel does not appear for it rather than appear and lie.
    const skip = m > 0 ? `.skip(${m})` : "";
    const cap = n >= 1 ? `.limit(${n})` : "";
    return `db.${parts.name}.find({})${skip}${cap}`;
  }
  return previewSelect(
    qualifiedName(parts, engine),
    engine,
    n,
    m,
    filter?.where,
    filter?.orderBy,
  );
}

/**
 * How many rows the object holds, narrowed by the same filter its preview uses
 * (issue #479) — the total an export needs to show a real percentage.
 *
 * Null when there is no cheap answer: MongoDB has no SQL surface here, and an
 * arbitrary query has no count that does not mean running it a second time. A
 * bar that has to re-run a heavy query to know how far along it is costs more
 * than the impatience it soothes, so those exports get a moving bar and a row
 * count instead of a fake percentage. Pure.
 */
export function objectCountQuery(
  parts: { db?: string; schema?: string; name: string },
  engine: string,
  filter?: PreviewFilter,
): string | null {
  if (engineFamily(engine) === "mongodb") return null;
  const where = filter?.where ? ` WHERE ${filter.where}` : "";
  // No ORDER BY: sorting an aggregate is work nobody reads.
  return `SELECT COUNT(*) AS n FROM ${qualifiedName(parts, engine)}${where};`;
}
