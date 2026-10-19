import { describe, it, expect } from "vitest";
import {
  fkBase,
  matchTable,
  inferRelations,
  realEdges,
  boxHeight,
  rowY,
  packGrid,
  relationOrder,
  segmentHits,
  routeEdge,
  pathD,
  endMark,
  fitZoom,
  ER_BOX,
  type ErTable,
  type Rect,
} from "../../src/utils/erDiagram";
import type { ForeignKey } from "../../src/utils/foreignKeys";

describe("fkBase", () => {
  it("recognizes snake and camel FK columns, ignores bare id", () => {
    expect(fkBase("customer_id")).toBe("customer");
    expect(fkBase("order_fk")).toBe("order");
    expect(fkBase("customerId")).toBe("customer");
    expect(fkBase("id")).toBeNull();
    expect(fkBase("name")).toBeNull();
  });
});

describe("matchTable", () => {
  const names = ["customers", "Order", "category"];
  it("matches exact, plural and singularized names", () => {
    expect(matchTable("customer", names)).toBe("customers"); // singularize
    expect(matchTable("order", names)).toBe("Order"); // exact (ci)
    expect(matchTable("category", names)).toBe("category");
    expect(matchTable("unknown", names)).toBeNull();
  });
});

describe("inferRelations", () => {
  const tables: ErTable[] = [
    {
      name: "orders",
      columns: [
        { name: "id", type: "int", pk: true },
        { name: "customer_id", type: "int", pk: false },
        { name: "total", type: "float", pk: false },
      ],
    },
    {
      name: "customers",
      columns: [
        { name: "id", type: "int", pk: true },
        { name: "name", type: "text", pk: false },
      ],
    },
  ];

  it("links a FK column to its referenced table", () => {
    expect(inferRelations(tables)).toEqual([
      { fromTable: "orders", fromColumn: "customer_id", toTable: "customers" },
    ]);
  });

  it("does not link a column with no matching table", () => {
    const t: ErTable[] = [
      { name: "orders", columns: [{ name: "widget_id", type: "int", pk: false }] },
    ];
    expect(inferRelations(t)).toEqual([]);
  });

  it("never self-links", () => {
    const t: ErTable[] = [
      {
        name: "nodes",
        columns: [
          { name: "id", type: "int", pk: true },
          { name: "node_id", type: "int", pk: false }, // -> nodes (self) => skipped
        ],
      },
    ];
    expect(inferRelations(t)).toEqual([]);
  });
});

describe("realEdges", () => {
  const fk = (fromTable: string, fromColumn: string, toTable: string, toColumn: string): ForeignKey => ({
    fromTable,
    fromColumn,
    toTable,
    toColumn,
  });

  it("maps a FK onto an edge carrying the referenced column", () => {
    expect(realEdges([fk("orders", "customer_id", "customers", "id")], ["orders", "customers"])).toEqual([
      { fromTable: "orders", fromColumn: "customer_id", toTable: "customers", toColumn: "id" },
    ]);
  });

  it("drops FKs whose endpoint is not in the diagram (e.g. truncated at MAX_TABLES)", () => {
    expect(realEdges([fk("orders", "warehouse_id", "warehouses", "id")], ["orders", "customers"])).toEqual([]);
  });

  it("normalizes endpoint casing back to the diagram's table names", () => {
    // catalog reports lower-case; diagram holds the real casing
    expect(realEdges([fk("orders", "cust_id", "customers", "id")], ["Orders", "Customers"])).toEqual([
      { fromTable: "Orders", fromColumn: "cust_id", toTable: "Customers", toColumn: "id" },
    ]);
  });

  it("keeps both pairs of a composite FK as two edges", () => {
    const fks = [fk("line", "order_id", "orders", "id"), fk("line", "order_seq", "orders", "seq")];
    expect(realEdges(fks, ["line", "orders"])).toHaveLength(2);
  });
});

describe("box geometry", () => {
  it("sizes a box from its rows and centres each row", () => {
    expect(boxHeight(3)).toBe(ER_BOX.header + 2 * ER_BOX.pad + 3 * ER_BOX.row);
    expect(rowY(100, 0)).toBe(100 + ER_BOX.header + ER_BOX.pad + ER_BOX.row / 2);
    expect(rowY(100, 2) - rowY(100, 1)).toBe(ER_BOX.row);
  });

  it("packs rows as tall as their tallest box", () => {
    const p = packGrid([100, 300, 50], 2, 200, 20, 10);
    expect(p).toEqual([
      { x: 10, y: 10 },
      { x: 210, y: 10 },
      { x: 10, y: 330 }, // 10 + 300 + 20
    ]);
    expect(packGrid([], 3, 200, 20)).toEqual([]);
  });
});

describe("relationOrder", () => {
  const tb = (name: string): ErTable => ({ name, columns: [] });
  it("puts related tables next to each other, the most connected first", () => {
    const tables = [tb("a"), tb("lone"), tb("b"), tb("hub"), tb("c")];
    const e = (fromTable: string, toTable: string) => ({ fromTable, fromColumn: "x", toTable });
    const order = relationOrder(tables, [e("a", "hub"), e("b", "hub"), e("c", "hub"), e("c", "b")]);
    expect(order[0]).toBe("hub");
    expect(order.slice(0, 4).sort()).toEqual(["a", "b", "c", "hub"]);
    expect(order[4]).toBe("lone");
  });

  it("ignores self references and keeps every table once", () => {
    const order = relationOrder([tb("n"), tb("m")], [{ fromTable: "n", fromColumn: "p", toTable: "n" }]);
    expect(order.sort()).toEqual(["m", "n"]);
  });
});

describe("segmentHits", () => {
  const r: Rect = { x: 10, y: 10, w: 20, h: 20 };
  it("tells a crossing from a pass-by, with the gap", () => {
    expect(segmentHits({ x: 0, y: 20 }, { x: 50, y: 20 }, r, 0)).toBe(true);
    expect(segmentHits({ x: 0, y: 35 }, { x: 50, y: 35 }, r, 0)).toBe(false);
    expect(segmentHits({ x: 0, y: 35 }, { x: 50, y: 35 }, r, 8)).toBe(true);
    expect(segmentHits({ x: 20, y: 0 }, { x: 20, y: 5 }, r, 0)).toBe(false);
    expect(segmentHits({ x: 20, y: 0 }, { x: 20, y: 50 }, r, 0)).toBe(true);
  });
});

describe("routeEdge", () => {
  const a: Rect = { x: 0, y: 0, w: 100, h: 100 };
  const b: Rect = { x: 300, y: 200, w: 100, h: 100 };

  it("leaves the facing sides at the rows' heights, orthogonally", () => {
    const r = routeEdge(a, 50, b, 250, []);
    expect(r.points[0]).toEqual({ x: 100, y: 50 });
    expect(r.points[r.points.length - 1]).toEqual({ x: 300, y: 250 });
    expect(r.intoFrom).toBe(-1);
    expect(r.intoTo).toBe(1);
    r.points.slice(1).forEach((p, i) => {
      const q = r.points[i];
      expect(p.x === q.x || p.y === q.y).toBe(true);
    });
  });

  it("goes round a box sitting in the gap", () => {
    const wall: Rect = { x: 170, y: 0, w: 60, h: 400 };
    const r = routeEdge(a, 50, b, 250, [wall]);
    r.points.slice(1).forEach((p, i) => expect(segmentHits(r.points[i], p, wall, 0)).toBe(false));
  });

  it("loops on the right side for a table that references itself", () => {
    const r = routeEdge(a, 40, a, 70, []);
    expect(r.points[0].x).toBe(100);
    expect(r.points[r.points.length - 1]).toEqual({ x: 100, y: 70 });
    expect(Math.max(...r.points.map((p) => p.x))).toBeGreaterThan(100);
  });

  it("enters from the right when the target lies to the left", () => {
    const r = routeEdge(b, 250, a, 50, []);
    expect(r.points[0]).toEqual({ x: 300, y: 250 });
    expect(r.points[r.points.length - 1]).toEqual({ x: 100, y: 50 });
  });
});

describe("drawing helpers", () => {
  it("writes path data", () => {
    expect(pathD([{ x: 0, y: 1 }, { x: 2, y: 1 }])).toBe("M0,1 L2,1");
  });

  it("draws one as two bars and many as a foot with a circle", () => {
    const one = endMark("one", { x: 100, y: 50 }, 1);
    expect(one.d.match(/M/g)).toHaveLength(2);
    expect(one.circle).toBeUndefined();
    const many = endMark("many", { x: 100, y: 50 }, 1);
    expect(many.d).toBe("M88,50 L100,44 M88,50 L100,50 M88,50 L100,56");
    expect(many.circle).toEqual({ cx: 83, cy: 50, r: 3.5 });
    // Entering leftwards, the mark sits on the other side.
    expect(endMark("many", { x: 100, y: 50 }, -1).circle!.cx).toBe(117);
  });

  it("fits the content in the view within the limits", () => {
    expect(fitZoom({ w: 2000, h: 1000 }, { w: 1000, h: 1000 })).toBe(0.5);
    expect(fitZoom({ w: 100, h: 100 }, { w: 1000, h: 1000 })).toBe(2);
    expect(fitZoom({ w: 100000, h: 10 }, { w: 1000, h: 1000 })).toBe(0.25);
    expect(fitZoom({ w: 0, h: 0 }, { w: 1000, h: 1000 })).toBe(1);
  });
});
