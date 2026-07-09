// Pure helpers for the entity-relationship diagram (issue #145). Relationships
// are drawn from the engine's REAL foreign keys when it exposes them (see
// utils/foreignKeys.ts + realEdges below, issue #260); the naming-convention
// inference (a `customer_id` column points at `customer`/`customers`) is kept as
// an honest fallback for engines without FK metadata (MongoDB) and is labelled
// "inferidas" in the UI. Layout math (initial grid, box height) is pure here;
// dragging + SVG live in the component.

import type { ForeignKey } from "./foreignKeys";

export interface ErColumn {
  name: string;
  type: string;
  pk: boolean;
}

export interface ErTable {
  name: string;
  columns: ErColumn[];
}

/** A foreign-key relationship: fromTable.fromColumn -> toTable(.toColumn). The
    referenced column is only known for real FKs (undefined for name inference). */
export interface ErEdge {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn?: string;
}

/**
 * The referenced base name of a foreign-key-looking column, or null. Recognizes
 * `foo_id`, `foo_fk` (snake case) and `fooId` (camel case). A bare `id` is the
 * table's own key, not a reference, so it returns null.
 */
export function fkBase(column: string): string | null {
  if (column.toLowerCase() === "id") return null;
  const snake = /^(.+?)_(?:id|fk)$/i.exec(column);
  if (snake && snake[1]) return snake[1];
  const camel = /^(.+?)Id$/.exec(column); // customerId -> customer
  if (camel && camel[1]) return camel[1];
  return null;
}

/**
 * Find the table a base name refers to (case-insensitive): an exact match, a
 * naive pluralization (base + s / es), or a table whose name singularizes to the
 * base (customers -> customer). Returns the actual table name or null.
 */
export function matchTable(base: string, tableNames: string[]): string | null {
  const b = base.toLowerCase();
  const candidates = [b, `${b}s`, `${b}es`];
  for (const n of tableNames) {
    const nl = n.toLowerCase();
    if (candidates.includes(nl)) return n;
    if (nl.replace(/e?s$/, "") === b) return n;
  }
  return null;
}

/** Infer FK edges across the tables by column naming (see fkBase/matchTable). */
export function inferRelations(tables: ErTable[]): ErEdge[] {
  const names = tables.map((t) => t.name);
  const edges: ErEdge[] = [];
  for (const t of tables) {
    for (const col of t.columns) {
      const base = fkBase(col.name);
      if (!base) continue;
      const target = matchTable(base, names);
      if (target && target !== t.name) {
        edges.push({ fromTable: t.name, fromColumn: col.name, toTable: target });
      }
    }
  }
  return edges;
}

/**
 * Map real foreign keys onto ER edges, keeping only those whose BOTH endpoints
 * are tables currently in the diagram. Table names are matched case-insensitively
 * and normalized back to the diagram's actual casing so edge lookup by name works.
 */
export function realEdges(fks: ForeignKey[], tableNames: string[]): ErEdge[] {
  const byLower = new Map(tableNames.map((n) => [n.toLowerCase(), n]));
  const edges: ErEdge[] = [];
  for (const fk of fks) {
    const from = byLower.get(fk.fromTable.toLowerCase());
    const to = byLower.get(fk.toTable.toLowerCase());
    if (!from || !to) continue;
    edges.push({ fromTable: from, fromColumn: fk.fromColumn, toTable: to, toColumn: fk.toColumn });
  }
  return edges;
}

/** Height of a table box: header + one row per column. */
export function tableHeight(columnCount: number, headerH: number, rowH: number): number {
  return headerH + columnCount * rowH;
}

/** Initial grid positions (top-left corners) for `n` boxes across `cols` columns. */
export function gridPositions(
  n: number,
  cols: number,
  cellW: number,
  cellH: number,
  pad = 24,
): { x: number; y: number }[] {
  const c = Math.max(1, cols);
  return Array.from({ length: n }, (_, i) => ({
    x: (i % c) * cellW + pad,
    y: Math.floor(i / c) * cellH + pad,
  }));
}
