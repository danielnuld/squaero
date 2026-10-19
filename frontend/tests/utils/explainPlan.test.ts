import { describe, it, expect } from "vitest";
import {
  planRows,
  explainKind,
  buildStructuredExplain,
  parsePlan,
  expensivePath,
  analyzeBlocked,
  visibleRows,
  planTotals,
  planText,
  nodeWeight,
  type PlanNode,
} from "../../src/utils/explainPlan";

describe("explainKind / buildStructuredExplain", () => {
  it("maps engines to their structured format", () => {
    expect(explainKind("postgres")).toBe("pg-json");
    expect(explainKind("mysql")).toBe("mysql-json");
    expect(explainKind("mariadb")).toBe("mysql-json");
    expect(explainKind("sqlite")).toBe("sqlite-qp");
    expect(explainKind("informix")).toBeNull();
    expect(explainKind("mongodb")).toBe("mongo-explain");
  });

  it("builds the right EXPLAIN and strips the trailing semicolon", () => {
    expect(buildStructuredExplain("postgres", "SELECT 1;")).toBe("EXPLAIN (FORMAT JSON) SELECT 1");
    expect(buildStructuredExplain("mysql", "SELECT 1")).toBe("EXPLAIN FORMAT=JSON SELECT 1");
    expect(buildStructuredExplain("sqlite", "SELECT 1")).toBe("EXPLAIN QUERY PLAN SELECT 1");
    expect(buildStructuredExplain("informix", "SELECT 1")).toBeNull();
    expect(buildStructuredExplain("postgres", "  ")).toBeNull();
  });

  it("MongoDB: asks the driver for the plan of the statement, without running it", () => {
    expect(buildStructuredExplain("mongodb", "db.users.find({a: 1});")).toBe(
      'db.users.find({a: 1}).explain("queryPlanner")',
    );
    expect(buildStructuredExplain("mongodb", "db.users.aggregate([])")).toBe(
      'db.users.aggregate([]).explain("queryPlanner")',
    );
    expect(buildStructuredExplain("mongodb", "SELECT 1")).toBeNull();
  });
});

describe("parsePlan — PostgreSQL JSON", () => {
  const pg = JSON.stringify([
    {
      Plan: {
        "Node Type": "Nested Loop",
        "Total Cost": 100.5,
        "Plan Rows": 10,
        Plans: [
          { "Node Type": "Seq Scan", "Relation Name": "orders", "Total Cost": 60, "Plan Rows": 100 },
          {
            "Node Type": "Index Scan",
            "Relation Name": "customers",
            "Index Name": "pk_customers",
            "Total Cost": 30,
            "Plan Rows": 1,
          },
        ],
      },
    },
  ]);

  it("builds a normalized tree with op/table/rows/cost", () => {
    const root = parsePlan("pg-json", ["QUERY PLAN"], [[pg]])!;
    expect(root.op).toBe("Nested Loop");
    expect(root.cost).toBe(100.5);
    expect(root.children.map((c) => c.table)).toEqual(["orders", "customers"]);
    expect(root.children[1].detail).toContain("pk_customers");
  });

  it("returns null on non-JSON", () => {
    expect(parsePlan("pg-json", ["x"], [["not json"]])).toBeNull();
  });
});

describe("parsePlan — MySQL JSON", () => {
  const mysql = JSON.stringify({
    query_block: {
      select_id: 1,
      cost_info: { query_cost: "12.5" },
      nested_loop: [
        { table: { table_name: "orders", access_type: "ALL", rows_examined_per_scan: 100, cost_info: { prefix_cost: "5.0" } } },
        { table: { table_name: "customers", access_type: "eq_ref", key: "PRIMARY", rows_produced_per_join: 1, cost_info: { prefix_cost: "12.5" } } },
      ],
    },
  });

  it("walks query_block + nested_loop into a tree", () => {
    const root = parsePlan("mysql-json", ["EXPLAIN"], [[mysql]])!;
    expect(root.op).toBe("query_block");
    expect(root.cost).toBe(12.5);
    expect(root.children.map((c) => c.table)).toEqual(["orders", "customers"]);
    expect(root.children[0].op).toBe("ALL");
    expect(root.children[1].detail).toContain("PRIMARY");
  });

  it("descends through an ordering_operation wrapper (ORDER BY)", () => {
    const ordered = JSON.stringify({
      query_block: {
        select_id: 1,
        ordering_operation: {
          using_filesort: true,
          table: { table_name: "events", access_type: "ALL", rows_examined_per_scan: 500 },
        },
      },
    });
    const root = parsePlan("mysql-json", ["EXPLAIN"], [[ordered]])!;
    // Single child, no root cost -> collapses to that table node.
    expect(root.table).toBe("events");
    expect(root.op).toBe("ALL");
  });

  it("never throws on an unexpected shape (best-effort, not a crash)", () => {
    const weird = JSON.stringify({ query_block: { select_id: 9, message: "no tables used" } });
    const root = parsePlan("mysql-json", ["EXPLAIN"], [[weird]]);
    // Degenerate but valid: a query_block node with no children, never null-crash.
    expect(root).not.toBeNull();
    expect(root!.children).toHaveLength(0);
  });
});

describe("parsePlan — SQLite EXPLAIN QUERY PLAN", () => {
  it("links rows into a tree by parent id", () => {
    const cols = ["id", "parent", "notused", "detail"];
    const rows = [
      ["2", "0", "0", "SCAN TABLE orders"],
      ["4", "0", "0", "SEARCH TABLE customers USING INTEGER PRIMARY KEY (rowid=?)"],
    ];
    const root = parsePlan("sqlite-qp", cols, rows)!;
    expect(root.op).toBe("QUERY PLAN");
    expect(root.children).toHaveLength(2);
    expect(root.children[0].op).toBe("SCAN");
    expect(root.children[0].table).toBe("orders");
    expect(root.children[1].op).toBe("SEARCH");
  });

  it("returns null when the expected columns are absent", () => {
    expect(parsePlan("sqlite-qp", ["foo"], [["bar"]])).toBeNull();
  });
});

describe("expensivePath", () => {
  const tree: PlanNode = {
    id: 0,
    op: "root",
    cost: 100,
    children: [
      { id: 1, op: "a", cost: 60, children: [{ id: 3, op: "a1", cost: 55, children: [] }] },
      { id: 2, op: "b", cost: 30, children: [] },
    ],
  };
  it("descends greedily following the heaviest child to a leaf", () => {
    expect([...expensivePath(tree)]).toEqual([0, 1, 3]);
  });
  it("nodeWeight prefers cost, then rows, then 0", () => {
    expect(nodeWeight({ id: 0, op: "x", cost: 5, rows: 9, children: [] })).toBe(5);
    expect(nodeWeight({ id: 0, op: "x", rows: 9, children: [] })).toBe(9);
    expect(nodeWeight({ id: 0, op: "x", children: [] })).toBe(0);
  });
});

describe("parsePlan — MongoDB explain", () => {
  const cols = ["explainVersion", "queryPlanner", "executionStats", "serverInfo", "ok"];
  const row = (qp: unknown, stats?: unknown): (string | null)[][] => [
    ["1", JSON.stringify(qp), stats === undefined ? null : JSON.stringify(stats), "{}", "1"],
  ];

  it("turns the winning plan into a tree: FETCH over IXSCAN", () => {
    const plan = parsePlan(
      "mongo-explain",
      cols,
      row({
        namespace: "shop.orders",
        winningPlan: {
          stage: "LIMIT",
          inputStage: {
            stage: "FETCH",
            filter: { status: { $eq: "open" } },
            inputStage: { stage: "IXSCAN", indexName: "total_1", direction: "forward" },
          },
        },
        rejectedPlans: [{ stage: "COLLSCAN" }],
      }),
    )!;
    expect(plan.op).toBe("LIMIT");
    expect(plan.detail).toContain("1 plan(es) descartado(s)");
    const fetch = plan.children[0];
    expect(fetch.op).toBe("FETCH");
    expect(fetch.detail).toContain("filtro");
    const scan = fetch.children[0];
    expect(scan.op).toBe("IXSCAN");
    expect(scan.table).toBe("orders");
    expect(scan.detail).toBe("índice total_1");
    expect(scan.children).toEqual([]);
  });

  it("a collection scan names the collection", () => {
    const plan = parsePlan(
      "mongo-explain",
      cols,
      row({ namespace: "d.my.coll", winningPlan: { stage: "COLLSCAN", direction: "backward" } }),
    )!;
    expect(plan.op).toBe("COLLSCAN");
    expect(plan.table).toBe("my.coll");
    expect(plan.detail).toBe("descendente");
  });

  it("an index intersection or OR has several inputs", () => {
    const plan = parsePlan(
      "mongo-explain",
      cols,
      row({
        namespace: "d.c",
        winningPlan: {
          stage: "OR",
          inputStages: [
            { stage: "IXSCAN", indexName: "a_1" },
            { stage: "IXSCAN", indexName: "b_1" },
          ],
        },
      }),
    )!;
    expect(plan.children.map((c) => c.detail)).toEqual(["índice a_1", "índice b_1"]);
  });

  it("a sharded cluster nests each shard's plan", () => {
    const plan = parsePlan(
      "mongo-explain",
      cols,
      row({
        namespace: "d.c",
        winningPlan: {
          stage: "SHARD_MERGE",
          shards: [
            { shardName: "s1", winningPlan: { stage: "COLLSCAN" } },
            { shardName: "s2", winningPlan: { stage: "IXSCAN", indexName: "x" } },
          ],
        },
      }),
    )!;
    expect(plan.op).toBe("SHARD_MERGE");
    expect(plan.children.map((c) => c.op)).toEqual(["Shard s1", "Shard s2"]);
    expect(plan.children[1].children[0].op).toBe("IXSCAN");
  });

  it("the slot-based engine's queryPlan is unwrapped", () => {
    const plan = parsePlan(
      "mongo-explain",
      cols,
      row({
        namespace: "d.c",
        winningPlan: { queryPlan: { stage: "GROUP", inputStage: { stage: "COLLSCAN" } }, slotBasedPlan: {} },
      }),
    )!;
    expect(plan.op).toBe("GROUP");
    expect(plan.children[0].op).toBe("COLLSCAN");
  });

  it("with executionStats the tree carries rows and time per stage", () => {
    const plan = parsePlan(
      "mongo-explain",
      cols,
      row(
        { namespace: "d.c", winningPlan: { stage: "COLLSCAN" } },
        {
          executionStages: {
            stage: "FETCH",
            nReturned: 7,
            executionTimeMillisEstimate: 3,
            inputStage: { stage: "IXSCAN", nReturned: 7, executionTimeMillisEstimate: 1, indexName: "i" },
          },
        },
      ),
    )!;
    expect(plan.op).toBe("FETCH");
    expect(plan.rows).toBe(7);
    expect(plan.cost).toBe(3);
    expect(plan.children[0].cost).toBe(1);
    expect(nodeWeight(plan)).toBe(3);
  });

  it("an aggregation explained stage by stage is a chain ending in the $cursor's plan", () => {
    const stages = [
      { $cursor: { queryPlanner: { namespace: "d.c", winningPlan: { stage: "COLLSCAN" } } } },
      { $group: { _id: "$a" } },
      { $sort: { _id: 1 } },
    ];
    const plan = parsePlan("mongo-explain", ["stages", "ok"], [[JSON.stringify(stages), "1"]])!;
    expect(plan.op).toBe("$sort");
    expect(plan.children[0].op).toBe("$group");
    const cursor = plan.children[0].children[0];
    expect(cursor.op).toBe("COLLSCAN");
    expect(cursor.table).toBe("c");
  });

  it("returns null when there is nothing it can read (the caller shows the raw text)", () => {
    expect(parsePlan("mongo-explain", cols, [])).toBeNull();
    expect(parsePlan("mongo-explain", cols, [["1", "not json", null, "{}", "1"]])).toBeNull();
    expect(parsePlan("mongo-explain", ["ok"], [["1"]])).toBeNull();
    expect(parsePlan("mongo-explain", cols, row({ namespace: "d.c" }))).toBeNull();
    expect(parsePlan("mongo-explain", ["stages"], [["[]"]])).toBeNull();
  });

  it("the costliest path follows the stage with the most time", () => {
    const plan = parsePlan(
      "mongo-explain",
      cols,
      row(
        { namespace: "d.c", winningPlan: { stage: "OR" } },
        {
          executionStages: {
            stage: "OR",
            executionTimeMillisEstimate: 10,
            inputStages: [
              { stage: "IXSCAN", executionTimeMillisEstimate: 1 },
              { stage: "COLLSCAN", executionTimeMillisEstimate: 9 },
            ],
          },
        },
      ),
    )!;
    const hot = expensivePath(plan);
    expect(hot.has(plan.children[1].id)).toBe(true);
    expect(hot.has(plan.children[0].id)).toBe(false);
  });
});

describe("planRows (table view)", () => {
  const node = (id: number, op: string, cost: number, children: PlanNode[] = [], table?: string): PlanNode => ({
    id,
    op,
    cost,
    rows: 10,
    table,
    children,
  });

  it("lists the nodes parent first, indented by depth", () => {
    const root = node(0, "Sort", 100, [
      node(1, "Hash Join", 80, [node(2, "Seq Scan", 50, [], "pedidos"), node(3, "Hash", 20, [node(4, "Seq Scan", 10, [], "clientes")])]),
    ]);
    const rows = planRows(root);
    expect(rows.map((r) => [r.op, r.depth, r.table])).toEqual([
      ["Sort", 0, undefined],
      ["Hash Join", 1, undefined],
      ["Seq Scan", 2, "pedidos"],
      ["Hash", 2, undefined],
      ["Seq Scan", 3, "clientes"],
    ]);
  });

  it("marks the costliest path as the tree does", () => {
    const root = node(0, "Join", 100, [node(1, "A", 70), node(2, "B", 20)]);
    expect(planRows(root).filter((r) => r.hot).map((r) => r.op)).toEqual(["Join", "A"]);
  });

  it("is one row for a single node", () => {
    expect(planRows(node(0, "Result", 0))).toHaveLength(1);
  });
});

describe("ANALYZE", () => {
  it("measures the plan on PostgreSQL and MongoDB", () => {
    expect(buildStructuredExplain("postgres", "SELECT 1", true)).toBe("EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1");
    expect(buildStructuredExplain("mongodb", "db.t.find({})", true)).toBe('db.t.find({}).explain("executionStats")');
    // Elsewhere the flag changes nothing: analyzeBlocked keeps it off.
    expect(buildStructuredExplain("sqlite", "SELECT 1", true)).toBe("EXPLAIN QUERY PLAN SELECT 1");
  });

  it("is offered only where measured and only for a statement that reads", () => {
    expect(analyzeBlocked("postgres", "SELECT * FROM t")).toBeNull();
    expect(analyzeBlocked("postgres", "DELETE FROM t")).toBe("plan.analyzeWrites");
    expect(analyzeBlocked("mongodb", "db.t.find({})")).toBeNull();
    expect(analyzeBlocked("mysql", "SELECT 1")).toBe("plan.analyzeEngine");
    expect(analyzeBlocked("sqlite", "SELECT 1")).toBe("plan.analyzeEngine");
  });

  it("reads PostgreSQL's measures, condition and properties", () => {
    const raw = JSON.stringify([
      {
        Plan: {
          "Node Type": "Sort",
          "Startup Cost": 83.9,
          "Total Cost": 86,
          "Plan Rows": 1240,
          "Plan Width": 48,
          "Actual Rows": 1000,
          "Actual Total Time": 2.1,
          "Actual Loops": 1,
          "Sort Key": ["fecha DESC"],
          "Sort Method": "top-N heapsort",
          Plans: [],
        },
      },
    ]);
    const n = parsePlan("pg-json", ["QUERY PLAN"], [[raw]])!;
    expect(n).toMatchObject({ actualRows: 1000, actualTime: 2.1, loops: 1, startupCost: 83.9, width: 48 });
    expect(n.detail).toBe("fecha DESC");
    expect(n.props).toEqual([
      ["Sort Key", "fecha DESC"],
      ["Sort Method", "top-N heapsort"],
    ]);
  });
});

describe("plan rows, totals and text", () => {
  const tree: PlanNode = {
    id: 0,
    op: "Sort",
    cost: 100,
    actualTime: 4.1,
    children: [
      { id: 1, op: "Hash Join", cost: 90, children: [
        { id: 2, op: "Seq Scan", table: "pedidos", cost: 60, rows: 1240, children: [] },
        { id: 3, op: "Hash", cost: 10, children: [] },
      ] },
    ],
  };

  it("works out each node's own cost and share, and the costliest node", () => {
    const rows = planRows(tree);
    expect(rows.map((r) => r.selfCost)).toEqual([10, 20, 60, 10]);
    expect(rows.map((r) => r.share)).toEqual([0.1, 0.2, 0.6, 0.1]);
    expect(rows.filter((r) => r.costliest).map((r) => r.op)).toEqual(["Seq Scan"]);
    expect(rows.map((r) => r.parent)).toEqual([null, 0, 1, 1]);
    expect(rows.map((r) => r.hasChildren)).toEqual([true, true, false, false]);
  });

  it("has no share without costs", () => {
    const rows = planRows({ id: 0, op: "SCAN", children: [] });
    expect(rows[0].selfCost).toBeUndefined();
    expect(rows[0].share).toBeUndefined();
    expect(rows[0].costliest).toBe(false);
  });

  it("hides the descendants of a folded node", () => {
    const rows = planRows(tree);
    expect(visibleRows(rows, new Set([1])).map((r) => r.id)).toEqual([0, 1]);
    expect(visibleRows(rows, new Set([0])).map((r) => r.id)).toEqual([0]);
    expect(visibleRows(rows, new Set())).toHaveLength(4);
  });

  it("totals the plan", () => {
    expect(planTotals(tree)).toEqual({ nodes: 4, cost: 100, time: 4.1 });
  });

  it("writes the plan as indented text", () => {
    expect(planText(tree).split("\n")).toEqual([
      "Sort  [cost=100 time=4.1ms]",
      "  -> Hash Join  [cost=90]",
      "    -> Seq Scan on pedidos  [rows=1240 cost=60]",
      "    -> Hash  [cost=10]",
    ]);
  });
});
