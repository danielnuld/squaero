import { describe, it, expect } from "vitest";
import {
  fkBase,
  matchTable,
  inferRelations,
  realEdges,
  tableHeight,
  gridPositions,
  type ErTable,
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

describe("layout", () => {
  it("computes box height from column count", () => {
    expect(tableHeight(3, 24, 20)).toBe(84);
  });
  it("lays boxes out in a grid", () => {
    const p = gridPositions(3, 2, 200, 160, 10);
    expect(p[0]).toEqual({ x: 10, y: 10 });
    expect(p[1]).toEqual({ x: 210, y: 10 });
    expect(p[2]).toEqual({ x: 10, y: 170 }); // wraps to next row
  });
});
