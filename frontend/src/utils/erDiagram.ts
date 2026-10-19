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
  /** A view: drawn with a dashed border, it takes part in no relation. */
  view?: boolean;
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

// ---- Geometry (audit A-31) -------------------------------------------------
// A box is a header and one row per column; an edge leaves the FK column's row
// and enters the referenced column's row, on the facing sides, with the
// crow's-foot notation at each end. Everything below is plain arithmetic.

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Box metrics: width, header, padding above and below the rows, row height. */
export const ER_BOX = { w: 220, header: 32, pad: 4, row: 22 } as const;

/** Height of a table box with `columns` rows. */
export function boxHeight(columns: number): number {
  return ER_BOX.header + 2 * ER_BOX.pad + columns * ER_BOX.row;
}

/** The vertical centre of row `i` in a box whose top is `top`. */
export function rowY(top: number, i: number): number {
  return top + ER_BOX.header + ER_BOX.pad + ER_BOX.row * i + ER_BOX.row / 2;
}

/**
 * Grid positions for boxes of the given heights, `cols` per row: each row is
 * as tall as its tallest box, so a long table never runs into the next row.
 */
export function packGrid(heights: number[], cols: number, cellW: number, gapY: number, pad = 24): Pt[] {
  const c = Math.max(1, cols);
  const out: Pt[] = [];
  let y = pad;
  for (let start = 0; start < heights.length; start += c) {
    const row = heights.slice(start, start + c);
    row.forEach((_, i) => out.push({ x: pad + i * cellW, y }));
    y += Math.max(...row) + gapY;
  }
  return out;
}

/**
 * Table names ordered so related tables sit next to each other in the grid:
 * a breadth-first walk from the most connected table, each component in turn,
 * neighbours by how connected they are. Unrelated tables keep their order.
 */
export function relationOrder(tables: ErTable[], edges: ErEdge[]): string[] {
  const near = new Map<string, Set<string>>(tables.map((t) => [t.name, new Set<string>()]));
  for (const e of edges) {
    if (e.fromTable === e.toTable) continue;
    near.get(e.fromTable)?.add(e.toTable);
    near.get(e.toTable)?.add(e.fromTable);
  }
  const degree = (n: string) => near.get(n)?.size ?? 0;
  const seeds = tables.map((t) => t.name).sort((a, b) => degree(b) - degree(a));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seed of seeds) {
    if (seen.has(seed)) continue;
    seen.add(seed);
    const queue = [seed];
    while (queue.length) {
      const n = queue.shift()!;
      out.push(n);
      for (const m of [...(near.get(n) ?? [])].sort((a, b) => degree(b) - degree(a))) {
        if (!seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
    }
  }
  return out;
}

/** Does the axis-aligned segment p→q pass through `r` grown by `gap`? */
export function segmentHits(p: Pt, q: Pt, r: Rect, gap: number): boolean {
  const left = r.x - gap;
  const right = r.x + r.w + gap;
  const top = r.y - gap;
  const bottom = r.y + r.h + gap;
  if (p.y === q.y) {
    return p.y > top && p.y < bottom && Math.max(p.x, q.x) > left && Math.min(p.x, q.x) < right;
  }
  return p.x > left && p.x < right && Math.max(p.y, q.y) > top && Math.min(p.y, q.y) < bottom;
}

/** Where an edge leaves `from` and enters `to`, and the way into each box. */
export interface Route {
  points: Pt[];
  /** Horizontal direction pointing INTO the box at each end (+1 = rightwards). */
  intoFrom: 1 | -1;
  intoTo: 1 | -1;
}

/**
 * An orthogonal route from row `ay` of box `a` to row `by` of box `b` that
 * keeps clear of the other boxes. Facing sides when the boxes are apart, both
 * right sides (a loop) when they overlap horizontally or are the same box. The
 * vertical run is tried in the gap, then beside each obstacle; failing that,
 * the edge goes round above or below everything.
 */
export function routeEdge(a: Rect, ay: number, b: Rect, by: number, obstacles: Rect[], stub = 24, gap = 8): Route {
  const aR = a.x + a.w;
  const bR = b.x + b.w;
  let sa: 1 | -1 = 1;
  let sb: 1 | -1 = 1;
  if (aR + 2 * stub <= b.x) sb = -1;
  else if (bR + 2 * stub <= a.x) sa = -1;
  const p0 = { x: sa > 0 ? aR : a.x, y: ay };
  const p3 = { x: sb > 0 ? bR : b.x, y: by };
  const x1 = p0.x + sa * stub;
  const x2 = p3.x + sb * stub;
  const clear = (pts: Pt[]) =>
    pts.every((p, i) => i === 0 || !obstacles.some((r) => segmentHits(pts[i - 1], p, r, gap)));
  const via = (x: number): Pt[] => [p0, { x, y: ay }, { x, y: by }, p3];
  const done = (points: Pt[]): Route => ({ points: dedupe(points), intoFrom: (-sa) as 1 | -1, intoTo: (-sb) as 1 | -1 });

  const xs: number[] = [];
  if (sa !== sb) {
    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    const beside = obstacles.flatMap((r) => [r.x - 2 * gap, r.x + r.w + 2 * gap]);
    xs.push((x1 + x2) / 2, ...beside.filter((x) => x >= lo && x <= hi));
  } else {
    const base = Math.max(x1, x2);
    xs.push(base);
    for (const r of obstacles) if (r.x + r.w + 2 * gap > base) xs.push(r.x + r.w + 2 * gap);
    xs.sort((p, q) => p - q);
  }
  for (const x of xs) {
    const pts = via(x);
    if (clear(pts)) return done(pts);
  }
  const all = [a, b, ...obstacles];
  const above = Math.min(...all.map((r) => r.y)) - 2 * gap;
  const below = Math.max(...all.map((r) => r.y + r.h)) + 2 * gap;
  for (const y of [above, below]) {
    const pts = [p0, { x: x1, y: ay }, { x: x1, y }, { x: x2, y }, { x: x2, y: by }, p3];
    if (clear(pts)) return done(pts);
  }
  return done(via(xs[0]));
}

function dedupe(points: Pt[]): Pt[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}

/** SVG path data through the points. */
export function pathD(points: Pt[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
}

/**
 * The crow's-foot mark at an edge's end, which touches its box at `end` and
 * enters it in direction `into`: «one» (exactly one, the referenced key) is two
 * bars; «many» (zero or many, the foreign key) is a circle and the three-toed
 * foot spreading onto the box.
 */
export function endMark(
  kind: "one" | "many",
  end: Pt,
  into: 1 | -1,
): { d: string; circle?: { cx: number; cy: number; r: number } } {
  const at = (dx: number) => end.x - into * dx;
  if (kind === "one") {
    return { d: [6, 10].map((dx) => `M${at(dx)},${end.y - 6} L${at(dx)},${end.y + 6}`).join(" ") };
  }
  const heel = at(12);
  return {
    d: [-6, 0, 6].map((dy) => `M${heel},${end.y} L${end.x},${end.y + dy}`).join(" "),
    circle: { cx: at(17), cy: end.y, r: 3.5 },
  };
}

/** The zoom that fits `content` in `view`, between the zoom limits. */
export function fitZoom(content: { w: number; h: number }, view: { w: number; h: number }, min = 0.25, max = 2): number {
  if (content.w <= 0 || content.h <= 0 || view.w <= 0 || view.h <= 0) return 1;
  const z = Math.min(view.w / content.w, view.h / content.h);
  return Math.min(max, Math.max(min, Math.floor(z * 20) / 20));
}
