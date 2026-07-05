import { describe, it, expect } from "vitest";
import {
  explainKind,
  buildStructuredExplain,
  parsePlan,
  expensivePath,
  layoutPlan,
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
    expect(explainKind("mongodb")).toBeNull();
  });

  it("builds the right EXPLAIN and strips the trailing semicolon", () => {
    expect(buildStructuredExplain("postgres", "SELECT 1;")).toBe("EXPLAIN (FORMAT JSON) SELECT 1");
    expect(buildStructuredExplain("mysql", "SELECT 1")).toBe("EXPLAIN FORMAT=JSON SELECT 1");
    expect(buildStructuredExplain("sqlite", "SELECT 1")).toBe("EXPLAIN QUERY PLAN SELECT 1");
    expect(buildStructuredExplain("informix", "SELECT 1")).toBeNull();
    expect(buildStructuredExplain("postgres", "  ")).toBeNull();
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

describe("layoutPlan", () => {
  const tree: PlanNode = {
    id: 0,
    op: "root",
    children: [
      { id: 1, op: "a", children: [] },
      { id: 2, op: "b", children: [] },
    ],
  };
  it("places children on the next row and centers the parent over them", () => {
    const { nodes, edges, width, height } = layoutPlan(tree, { nodeW: 100, nodeH: 50, gapX: 20, gapY: 30 });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const a = byId.get(1)!;
    const b = byId.get(2)!;
    const root = byId.get(0)!;
    expect(a.y).toBe(80); // depth 1 * (50+30)
    expect(root.y).toBe(0);
    // Parent centered between the two leaves.
    expect(root.x + 50).toBeCloseTo((a.x + 50 + b.x + 50) / 2);
    expect(edges).toHaveLength(2);
    expect(width).toBeGreaterThan(0);
    expect(height).toBe(130); // two rows: 50 + 30 + 50
  });
});
