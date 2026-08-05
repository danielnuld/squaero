// "Related data" of one row (issue #310): which tables depend on the row you are
// standing on, and the query that lists each one's dependent rows.
//
// The foreign keys themselves come from utils/foreignKeys (the engine's real
// catalog, INBOUND direction: keys pointing AT this table), already grouped per
// constraint so a composite key travels whole. This module is the pure part on
// top of that:
//   1. which relationships hang off the column the user opened the modal from,
//   2. the WHERE built from that row's values — every column of the key, not just
//      the one clicked, or nothing at all when the result did not project one,
//   3. the SELECT and the COUNT(*) for a relationship.
//
// Unlike row editing (which hands values to the core as parameters and lets the
// driver quote them), the statements here are ordinary queries the user can see,
// copy and send to the editor, so the literals are built here — off the column's
// declared type, never guessed from the value.
//
// The dependent table is assumed to live in the SAME db/schema as the source
// table, the same assumption utils/fkLookup makes for the opposite direction.

import { classifyType } from "./format";
import type { ForeignKeyRelation } from "./foreignKeys";
import { previewSelect } from "./pagination";
import type { ResultColumn } from "./query";
import { qualifiedName, quoteIdentifier } from "./schema";

/** Rows loaded per relationship. Bounded: this is a peek, not a table view. */
export const RELATED_LIMIT = 200;

/** Where the dependent table is looked up (the source row's own scope). */
export interface RelatedScope {
  db?: string;
  schema?: string;
}

/** One dependent relationship prepared against a concrete source row. */
export interface RelatedQuery {
  relation: ForeignKeyRelation;
  /** The WHERE body (no keyword), or null when the row cannot fill it. */
  where: string | null;
  /** The source column the result did not project (only when `where` is null). */
  missing?: string;
  /** Readable filter for the list: `pedidos where cliente=3 and sucursal=1`. */
  label: string;
}

/**
 * A SQL literal for `value` given its column's declared type. Numbers go
 * unquoted; everything else is quoted with doubled single quotes. Booleans stay
 * quoted on purpose (engines spell them t/f, TRUE, 1 — the stored text is what
 * round-trips), mirroring the same decision in the row-editing path.
 */
export function sqlLiteral(value: string, type: string): string {
  if (classifyType(type) === "number" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return value.trim();
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Case-insensitive column lookup in a result's projection. */
function indexOfColumn(columns: ResultColumn[], name: string): number {
  const wanted = name.toLowerCase();
  return columns.findIndex((c) => c.name.toLowerCase() === wanted);
}

/** The relationships whose referenced key includes `column`. */
export function relationsForColumn(
  relations: ForeignKeyRelation[],
  column: string,
): ForeignKeyRelation[] {
  const wanted = column.toLowerCase();
  return relations.filter((r) => r.columns.some((c) => c.to.toLowerCase() === wanted));
}

/**
 * Prepares each relationship against the source row: the WHERE that selects its
 * dependent rows, or `missing` naming the key column the result never projected
 * (filtering on a partial key would report dependents that are not).
 */
export function relatedQueries(
  relations: ForeignKeyRelation[],
  columns: ResultColumn[],
  row: (string | null)[],
  engine: string,
): RelatedQuery[] {
  return relations.map((relation) => {
    const conditions: string[] = [];
    const readable: string[] = [];
    let missing: string | undefined;
    for (const pair of relation.columns) {
      const idx = indexOfColumn(columns, pair.to);
      if (idx === -1) {
        missing = pair.to;
        break;
      }
      const value = row[idx];
      const child = quoteIdentifier(pair.from, engine);
      if (value === null || value === undefined) {
        conditions.push(`${child} IS NULL`);
        readable.push(`${pair.from} IS NULL`);
      } else {
        const literal = sqlLiteral(value, columns[idx].type ?? "");
        conditions.push(`${child} = ${literal}`);
        readable.push(`${pair.from}=${value}`);
      }
    }
    const blocked = missing !== undefined;
    return {
      relation,
      where: blocked ? null : conditions.join(" AND "),
      ...(blocked ? { missing } : {}),
      label: blocked
        ? relation.fromTable
        : `${relation.fromTable} where ${readable.join(" and ")}`,
    };
  });
}

/** The paged SELECT listing a relationship's dependent rows. */
export function relatedSelect(
  query: RelatedQuery,
  engine: string,
  scope: RelatedScope = {},
  limit = RELATED_LIMIT,
): string | null {
  if (query.where === null) return null;
  const qualified = qualifiedName({ ...scope, name: query.relation.fromTable }, engine);
  return previewSelect(qualified, engine, limit, 0, query.where);
}

/**
 * The COUNT(*) answering "does this row have dependents here?" without opening
 * the relationship. Same filter as relatedSelect, so both agree.
 */
export function relatedCount(
  query: RelatedQuery,
  engine: string,
  scope: RelatedScope = {},
): string | null {
  if (query.where === null) return null;
  const qualified = qualifiedName({ ...scope, name: query.relation.fromTable }, engine);
  return `SELECT COUNT(*) FROM ${qualified} WHERE ${query.where};`;
}
