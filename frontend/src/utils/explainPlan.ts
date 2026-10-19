// Structured EXPLAIN parsing + layout for the visual plan (issue #187). Pure and
// tested; the component runs the SQL these build and renders the tree as SVG (no
// graph library, same self-contained approach as the ER diagram #145). Each
// engine exposes a different structured format:
//   - PostgreSQL: EXPLAIN (FORMAT JSON) -> a nested Plan tree (canonical).
//   - MySQL/MariaDB: EXPLAIN FORMAT=JSON -> a query_block tree (irregular).
//   - SQLite: EXPLAIN QUERY PLAN -> flat rows linked by parent id.
//   - MongoDB: the explain command (the driver runs `<find|aggregate>.explain()`)
//     -> one row whose queryPlanner / executionStats cells hold the stage tree.
// Anything else (Informix file-based plan) has no structured format and the
// caller falls back to the plain tabular EXPLAIN.

import { engineFamily as family } from "./engineFamily";
import { mongoExplainStatement } from "./mongoStatements";
import { classifySql } from "./safeMode";

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
  /** With ANALYZE: rows the node really produced, its time (ms) and loops. */
  actualRows?: number;
  actualTime?: number;
  loops?: number;
  /** Cost before the first row, and the average row width in bytes. */
  startupCost?: number;
  width?: number;
  /** Everything else the engine says about the node, in its own words. */
  props?: [string, string][];
  children: PlanNode[];
}

export type ExplainKind = "pg-json" | "mysql-json" | "sqlite-qp" | "mongo-explain";

/** Which structured EXPLAIN an engine supports, or null when none. */
export function explainKind(engine: string): ExplainKind | null {
  switch (family(engine)) {
    case "postgres":
      return "pg-json";
    case "mysql":
      return "mysql-json";
    case "sqlite":
      return "sqlite-qp";
    case "mongodb":
      return "mongo-explain";
    default:
      return null;
  }
}

const TRAILING_SEMI = /;\s*$/;

/** Build the structured-EXPLAIN statement for an engine, or null when the engine
    has no structured plan format. `analyze` runs the statement to measure it
    (see analyzeBlocked for when that is offered). */
export function buildStructuredExplain(engine: string, sql: string, analyze = false): string | null {
  const q = sql.trim().replace(TRAILING_SEMI, "");
  if (!q) return null;
  switch (explainKind(engine)) {
    case "mongo-explain": {
      const stmt = mongoExplainStatement(q);
      return stmt && analyze ? stmt.replace(/\.explain\("queryPlanner"\)$/, '.explain("executionStats")') : stmt;
    }
    case "pg-json":
      return analyze ? `EXPLAIN (ANALYZE, FORMAT JSON) ${q}` : `EXPLAIN (FORMAT JSON) ${q}`;
    case "mysql-json":
      return `EXPLAIN FORMAT=JSON ${q}`;
    case "sqlite-qp":
      return `EXPLAIN QUERY PLAN ${q}`;
    default:
      return null;
  }
}

/**
 * Why «Con ANALYZE» cannot be offered, as a message key, or null when it can.
 * ANALYZE RUNS the statement, so it is only offered for one that only reads;
 * and only where the structured plan carries the measures (PostgreSQL's
 * EXPLAIN ANALYZE, MongoDB's executionStats).
 */
export function analyzeBlocked(engine: string, sql: string): string | null {
  const k = explainKind(engine);
  if (k !== "pg-json" && k !== "mongo-explain") return "plan.analyzeEngine";
  if (classifySql(sql, engine) !== "read") return "plan.analyzeWrites";
  return null;
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
/** The condition that best says what a node does, first found wins. */
const PG_COND = ["Sort Key", "Hash Cond", "Merge Cond", "Join Filter", "Index Cond", "Recheck Cond", "Filter", "Group Key"];
/** The node properties the detail pane lists as the engine names them. */
const PG_PROPS = [
  "Alias",
  "Index Name",
  "Join Type",
  "Strategy",
  ...PG_COND,
  "Rows Removed by Filter",
  "Sort Method",
  "Sort Space Used",
  "Sort Space Type",
  "Hash Buckets",
  "Peak Memory Usage",
  "Parent Relationship",
];
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
    const text = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));
    const cond = PG_COND.map((k) => node[k]).find((v) => v !== undefined);
    const props = PG_PROPS.filter((k) => node[k] !== undefined).map((k): [string, string] => [k, text(node[k])]);
    return {
      id: nextId(),
      op,
      table,
      rows: num(node["Plan Rows"]),
      cost: num(node["Total Cost"]),
      detail: [idx, cond === undefined ? undefined : text(cond)].filter(Boolean).join(" · ") || undefined,
      actualRows: num(node["Actual Rows"]),
      actualTime: num(node["Actual Total Time"]),
      loops: num(node["Actual Loops"]),
      startupCost: num(node["Startup Cost"]),
      width: num(node["Plan Width"]),
      props: props.length ? props : undefined,
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

// ---- MongoDB: the explain command ------------------------------------------
// The driver returns one row; `queryPlanner` (and `executionStats`, when the
// statement asked for it) are JSON cells. A stage is {stage, inputStage |
// inputStages, indexName, filter, ...}; a sharded cluster nests each shard's plan
// under `shards`; an aggregation that is not fully pushed down returns `stages`
// instead, the $cursor stage holding the query plan.
type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

function parseMongoPlan(columns: string[], rows: (string | null)[][]): PlanNode | null {
  const row = rows[0];
  if (!row) return null;
  const cell = (name: string): unknown => {
    const i = columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
    const raw = i >= 0 ? row[i] : null;
    if (typeof raw !== "string") return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const nextId = makeIds();

  // The collection a leaf scan reads: the namespace without its database.
  const collOf = (ns: unknown) => (typeof ns === "string" && ns.includes(".") ? ns.slice(ns.indexOf(".") + 1) : undefined);

  const walkStage = (s: Json, coll: string | undefined): PlanNode => {
    const kids: PlanNode[] = [];
    if (isObj(s.inputStage)) kids.push(walkStage(s.inputStage, coll));
    if (Array.isArray(s.inputStages)) {
      for (const k of s.inputStages) if (isObj(k)) kids.push(walkStage(k, coll));
    }
    if (Array.isArray(s.shards)) {
      for (const sh of s.shards) {
        if (!isObj(sh)) continue;
        const inner = isObj(sh.executionStages) ? sh.executionStages : isObj(sh.winningPlan) ? sh.winningPlan : null;
        kids.push({
          id: nextId(),
          op: `Shard ${String(sh.shardName ?? "")}`.trim(),
          children: inner ? [walkStage(inner, coll)] : [],
        });
      }
    }
    const details: string[] = [];
    if (s.indexName) details.push(`índice ${String(s.indexName)}`);
    if (s.direction === "backward") details.push("descendente");
    if (isObj(s.filter)) details.push(`filtro ${JSON.stringify(s.filter)}`);
    if (isObj(s.indexBounds)) details.push(`límites ${JSON.stringify(s.indexBounds)}`);
    return {
      id: nextId(),
      op: String(s.stage ?? "STAGE"),
      table: kids.length === 0 ? coll : undefined,
      rows: num(s.nReturned),
      cost: num(s.executionTimeMillisEstimate),
      detail: details.length ? details.join(" · ") : undefined,
      children: kids,
    };
  };

  // The plan tree of one queryPlanner block (or its executionStats twin, which
  // carries the same stages plus nReturned / time per stage).
  const planOf = (qp: unknown, stats: unknown): PlanNode | null => {
    if (!isObj(qp)) return null;
    const coll = collOf(qp.namespace);
    const fromStats = isObj(stats) && isObj(stats.executionStages) ? stats.executionStages : null;
    let stage = fromStats ?? (isObj(qp.winningPlan) ? qp.winningPlan : null);
    // The slot-based engine wraps the classic stage tree in `queryPlan`.
    if (stage && !stage.stage && isObj(stage.queryPlan)) stage = stage.queryPlan;
    if (!stage) return null;
    const node = walkStage(stage, coll);
    const rejected = Array.isArray(qp.rejectedPlans) ? qp.rejectedPlans.length : 0;
    if (rejected > 0) {
      node.detail = [node.detail, `${rejected} plan(es) descartado(s)`].filter(Boolean).join(" · ");
    }
    return node;
  };

  const qp = cell("queryPlanner");
  if (qp !== undefined) return planOf(qp, cell("executionStats"));

  // Aggregation explained stage by stage: each stage feeds the next, so the tree
  // is a chain with the last stage on top and the $cursor (the query) at the bottom.
  const stages = cell("stages");
  if (!Array.isArray(stages) || stages.length === 0) return null;
  let below: PlanNode | null = null;
  for (const st of stages) {
    if (!isObj(st)) continue;
    const key = Object.keys(st)[0];
    if (!key) continue;
    const body = st[key];
    let node: PlanNode | null = null;
    if (key === "$cursor" && isObj(body)) node = planOf(body.queryPlanner, body.executionStats);
    if (!node) {
      node = { id: nextId(), op: key, children: [] };
    }
    if (below) node.children = [below];
    below = node;
  }
  return below;
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
  if (kind === "mongo-explain") return parseMongoPlan(columns, rows);
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

// ---- Table view (ExplainPlanTable) ------------------------------------------
/** One node of the plan as a row of the tree and table views, indented by `depth`. */
export interface PlanRow {
  id: number;
  depth: number;
  /** The parent's id; null for the root. */
  parent: number | null;
  hasChildren: boolean;
  op: string;
  table?: string;
  rows?: number;
  cost?: number;
  detail?: string;
  /** The node's own cost: its total less its children's (engines report it
      cumulative). Undefined when the engine gives no cost. */
  selfCost?: number;
  /** selfCost as a share (0..1) of the plan's summed own costs. */
  share?: number;
  /** On the costliest path from the root (the tree's highlight). */
  hot: boolean;
  /** The single node with the highest own cost. */
  costliest: boolean;
  node: PlanNode;
}

/** The plan flattened top-down (parent before children), as the views list it. */
export function planRows(root: PlanNode): PlanRow[] {
  const hot = expensivePath(root);
  const out: PlanRow[] = [];
  const walk = (n: PlanNode, depth: number, parent: number | null) => {
    const below = n.children.reduce((sum, c) => sum + (c.cost ?? 0), 0);
    out.push({
      id: n.id,
      depth,
      parent,
      hasChildren: n.children.length > 0,
      op: n.op,
      table: n.table,
      rows: n.rows,
      cost: n.cost,
      detail: n.detail,
      selfCost: n.cost === undefined ? undefined : Math.max(0, n.cost - below),
      hot: hot.has(n.id),
      costliest: false,
      node: n,
    });
    for (const c of n.children) walk(c, depth + 1, n.id);
  };
  walk(root, 0, null);
  const total = out.reduce((sum, r) => sum + (r.selfCost ?? 0), 0);
  let top: PlanRow | null = null;
  for (const r of out) {
    if (r.selfCost === undefined || total <= 0) continue;
    r.share = r.selfCost / total;
    if (!top || r.selfCost > top.selfCost!) top = r;
  }
  if (top) top.costliest = true;
  return out;
}

/** The rows still shown when the ids in `collapsed` are folded. */
export function visibleRows(rows: PlanRow[], collapsed: ReadonlySet<number>): PlanRow[] {
  const hidden = new Set<number>();
  return rows.filter((r) => {
    if (r.parent !== null && (hidden.has(r.parent) || collapsed.has(r.parent))) {
      hidden.add(r.id);
      return false;
    }
    return true;
  });
}

/** The plan's totals: nodes, the root's cost and, with ANALYZE, its time. */
export function planTotals(root: PlanNode): { nodes: number; cost?: number; time?: number } {
  let nodes = 0;
  const count = (n: PlanNode) => {
    nodes++;
    n.children.forEach(count);
  };
  count(root);
  return { nodes, cost: root.cost, time: root.actualTime };
}

/** The plan as indented text, one node per line, for «Texto» and «Copiar plan». */
export function planText(root: PlanNode): string {
  return planRows(root)
    .map((r) => {
      const n = r.node;
      const facts = [
        n.rows !== undefined ? `rows=${n.rows}` : null,
        n.actualRows !== undefined ? `actual=${n.actualRows}` : null,
        n.cost !== undefined ? `cost=${n.cost}` : null,
        n.actualTime !== undefined ? `time=${n.actualTime}ms` : null,
      ].filter(Boolean);
      const head = [r.op, r.table ? `on ${r.table}` : null, r.detail ? `(${r.detail})` : null].filter(Boolean).join(" ");
      return `${"  ".repeat(r.depth)}${r.depth ? "-> " : ""}${head}${facts.length ? `  [${facts.join(" ")}]` : ""}`;
    })
    .join("\n");
}
