// Structured EXPLAIN parsing + layout for the visual plan (issue #187). Pure and
// tested; the component runs the SQL these build and renders the tree as SVG (no
// graph library, same self-contained approach as the ER diagram #145). Each
// engine exposes a different structured format:
//   - PostgreSQL: EXPLAIN (FORMAT JSON) -> a nested Plan tree (canonical).
//   - MySQL/MariaDB: EXPLAIN FORMAT=JSON -> a query_block tree (irregular).
//   - SQLite: EXPLAIN QUERY PLAN -> flat rows linked by parent id.
// Anything else (Informix file-based plan, MongoDB) has no structured format and
// the caller falls back to the plain tabular EXPLAIN.

import { engineFamily as family } from "./engineFamily";

/** A normalized plan node. `weight` is the value used to find the costliest path
    (cost when the engine reports one, else estimated rows). */
export interface PlanNode {
  id: number;
  /** Operation label (e.g. "Seq Scan", "Nested Loop", "SEARCH"). */
  op: string;
  /** Relation/table the node operates on, when any. */
  table?: string;
  /** Estimated rows. */
  rows?: number;
  /** Estimated cost in engine units, when reported. */
  cost?: number;
  /** A secondary detail line (index used, filter, …). */
  detail?: string;
  children: PlanNode[];
}

export type ExplainKind = "pg-json" | "mysql-json" | "sqlite-qp";

/** Which structured EXPLAIN an engine supports, or null when none. */
export function explainKind(engine: string): ExplainKind | null {
  switch (family(engine)) {
    case "postgres":
      return "pg-json";
    case "mysql":
      return "mysql-json";
    case "sqlite":
      return "sqlite-qp";
    default:
      return null;
  }
}

const TRAILING_SEMI = /;\s*$/;

/** Build the structured-EXPLAIN statement for an engine, or null when the engine
    has no structured plan format. */
export function buildStructuredExplain(engine: string, sql: string): string | null {
  const q = sql.trim().replace(TRAILING_SEMI, "");
  if (!q) return null;
  switch (explainKind(engine)) {
    case "pg-json":
      return `EXPLAIN (FORMAT JSON) ${q}`;
    case "mysql-json":
      return `EXPLAIN FORMAT=JSON ${q}`;
    case "sqlite-qp":
      return `EXPLAIN QUERY PLAN ${q}`;
    default:
      return null;
  }
}

// A monotonic id generator threaded through a single parse.
function makeIds() {
  let n = 0;
  return () => n++;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

// ---- PostgreSQL: EXPLAIN (FORMAT JSON) ------------------------------------
// The single result cell holds a JSON array whose first element has a "Plan".
function parsePgPlan(raw: string): PlanNode | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = Array.isArray(data) ? (data[0] as { Plan?: unknown })?.Plan : undefined;
  if (!root || typeof root !== "object") return null;
  const nextId = makeIds();
  const walk = (node: Record<string, unknown>): PlanNode => {
    const op = String(node["Node Type"] ?? "Nodo");
    const table = node["Relation Name"] ? String(node["Relation Name"]) : undefined;
    const idx = node["Index Name"] ? `índice ${node["Index Name"]}` : undefined;
    const childPlans = Array.isArray(node["Plans"]) ? (node["Plans"] as Record<string, unknown>[]) : [];
    return {
      id: nextId(),
      op,
      table,
      rows: num(node["Plan Rows"]),
      cost: num(node["Total Cost"]),
      detail: idx,
      children: childPlans.map(walk),
    };
  };
  return walk(root as Record<string, unknown>);
}

// ---- MySQL/MariaDB: EXPLAIN FORMAT=JSON -----------------------------------
// The JSON is irregular: a query_block contains a table, or a nested_loop array,
// or ordering/grouping wrappers. Walk it, emitting a node whenever an object has
// a table_name, and threading nested_loop/wrappers as children.
function parseMysqlPlan(raw: string): PlanNode | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const qb = (data as { query_block?: unknown })?.query_block;
  if (!qb || typeof qb !== "object") return null;
  const nextId = makeIds();

  // Turn a "table" object into a node.
  const tableNode = (t: Record<string, unknown>): PlanNode => {
    const ci = t["cost_info"] as Record<string, unknown> | undefined;
    const access = t["access_type"] ? String(t["access_type"]) : "table";
    const key = t["key"] ? `índice ${t["key"]}` : undefined;
    return {
      id: nextId(),
      op: access,
      table: t["table_name"] ? String(t["table_name"]) : undefined,
      rows: num(t["rows_produced_per_join"]) ?? num(t["rows_examined_per_scan"]),
      cost: num(ci?.["prefix_cost"]) ?? num(ci?.["read_cost"]),
      detail: key,
      children: [],
    };
  };

  // Recursively collect the child plan nodes inside a query_block / wrapper.
  const collect = (obj: Record<string, unknown>): PlanNode[] => {
    const out: PlanNode[] = [];
    if (obj["table"] && typeof obj["table"] === "object") {
      out.push(tableNode(obj["table"] as Record<string, unknown>));
    }
    if (Array.isArray(obj["nested_loop"])) {
      for (const item of obj["nested_loop"] as Record<string, unknown>[]) {
        out.push(...collect(item));
      }
    }
    // Ordering/grouping/duplicates-removal wrappers nest another block.
    for (const wrapper of ["ordering_operation", "grouping_operation", "duplicates_removal"]) {
      const w = obj[wrapper];
      if (w && typeof w === "object") out.push(...collect(w as Record<string, unknown>));
    }
    return out;
  };

  const block = qb as Record<string, unknown>;
  const children = collect(block);
  const ci = block["cost_info"] as Record<string, unknown> | undefined;
  const rootCost = num(ci?.["query_cost"]);
  // A single child with no extra root info collapses to that child as the root.
  if (children.length === 1 && rootCost === undefined) return children[0];
  return {
    id: nextId(),
    op: "query_block",
    cost: rootCost,
    children,
  };
}

// ---- SQLite: EXPLAIN QUERY PLAN -------------------------------------------
// Rows are (id, parent, notused, detail); build the tree by parent linkage.
function parseSqlitePlan(columns: string[], rows: (string | null)[][]): PlanNode | null {
  const lc = columns.map((c) => c.toLowerCase());
  const idIdx = lc.indexOf("id");
  const parentIdx = lc.indexOf("parent");
  const detailIdx = lc.indexOf("detail");
  if (idIdx < 0 || parentIdx < 0 || detailIdx < 0) return null;

  const nodes = new Map<number, PlanNode>();
  const parentOf = new Map<number, number>();
  let seq = 0;
  const root: PlanNode = { id: -1, op: "QUERY PLAN", children: [] };
  for (const row of rows) {
    const rid = num(row[idIdx]);
    const pid = num(row[parentIdx]) ?? 0;
    const detail = row[detailIdx] ?? "";
    if (rid === undefined) continue;
    // Derive a short op from the detail's leading keyword (SCAN/SEARCH/USE…).
    const opMatch = /^([A-Z][A-Z ]+?)(?:\s+(?:TABLE|SUBQUERY|USING)\b|$)/.exec(detail);
    const op = opMatch ? opMatch[1].trim() : "STEP";
    const tblMatch = /\bTABLE\s+(\w+)/.exec(detail);
    nodes.set(rid, {
      id: seq++,
      op,
      table: tblMatch ? tblMatch[1] : undefined,
      detail,
      children: [],
    });
    parentOf.set(rid, pid);
  }
  for (const [rid, node] of nodes) {
    const pid = parentOf.get(rid) ?? 0;
    const parent = pid && nodes.has(pid) ? nodes.get(pid)! : root;
    parent.children.push(node);
  }
  if (root.children.length === 0) return null;
  return root.children.length === 1 ? root.children[0] : root;
}

/**
 * Parse a structured-EXPLAIN result into a normalized plan tree, or null when it
 * can't be parsed (caller falls back to the plain tabular EXPLAIN). `cell` is the
 * JSON string for the JSON formats (first row, first column).
 */
export function parsePlan(
  kind: ExplainKind,
  columns: string[],
  rows: (string | null)[][],
): PlanNode | null {
  if (kind === "sqlite-qp") return parseSqlitePlan(columns, rows);
  const cell = rows[0]?.[0];
  if (typeof cell !== "string") return null;
  return kind === "pg-json" ? parsePgPlan(cell) : parseMysqlPlan(cell);
}

/** The node weight used to rank cost: explicit cost, else rows, else 0. */
export function nodeWeight(n: PlanNode): number {
  return n.cost ?? n.rows ?? 0;
}

/**
 * Ids on the costliest path: a greedy root-to-leaf descent that follows the
 * heaviest child at each level. Greedy descent (rather than "single max node")
 * is what stays meaningful for engines with cumulative costs like PostgreSQL,
 * where the root always holds the largest total. Returns a Set for O(1) lookup
 * when rendering the highlight.
 */
export function expensivePath(root: PlanNode): Set<number> {
  const path: number[] = [];
  let node: PlanNode | undefined = root;
  while (node) {
    path.push(node.id);
    if (node.children.length === 0) break;
    node = node.children.reduce((a, b) => (nodeWeight(b) > nodeWeight(a) ? b : a));
  }
  return new Set(path);
}

// ---- Layout ----------------------------------------------------------------
export interface LaidOutNode extends PlanNode {
  x: number;
  y: number;
}
export interface PlanEdge {
  from: { x: number; y: number };
  to: { x: number; y: number };
}
export interface PlanLayout {
  nodes: LaidOutNode[];
  edges: PlanEdge[];
  width: number;
  height: number;
}

export interface LayoutOpts {
  nodeW: number;
  nodeH: number;
  gapX: number;
  gapY: number;
}

export const DEFAULT_LAYOUT: LayoutOpts = { nodeW: 160, nodeH: 56, gapX: 24, gapY: 40 };

/**
 * Tidy top-down tree layout: leaves are placed left-to-right in visit order, an
 * internal node is centered over its children, and depth sets the row. Pure, so
 * the SVG geometry is unit-testable.
 */
export function layoutPlan(root: PlanNode, opts: LayoutOpts = DEFAULT_LAYOUT): PlanLayout {
  const { nodeW, nodeH, gapX, gapY } = opts;
  const nodes: LaidOutNode[] = [];
  const centerX = new Map<number, number>();
  let leafCursor = 0;

  const stepX = nodeW + gapX;
  const stepY = nodeH + gapY;

  const place = (node: PlanNode, depth: number): number => {
    let cx: number;
    if (node.children.length === 0) {
      cx = leafCursor * stepX + nodeW / 2;
      leafCursor += 1;
    } else {
      const childCenters = node.children.map((c) => place(c, depth + 1));
      cx = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    }
    centerX.set(node.id, cx);
    nodes.push({ ...node, x: cx - nodeW / 2, y: depth * stepY, children: node.children });
    return cx;
  };
  place(root, 0);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: PlanEdge[] = [];
  for (const n of nodes) {
    for (const c of n.children) {
      const cn = byId.get(c.id);
      if (!cn) continue;
      edges.push({
        from: { x: n.x + nodeW / 2, y: n.y + nodeH },
        to: { x: cn.x + nodeW / 2, y: cn.y },
      });
    }
  }

  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + nodeW), 0);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + nodeH), 0);
  return { nodes, edges, width: maxX, height: maxY };
}
