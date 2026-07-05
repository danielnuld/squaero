import { describe, it, expect } from "vitest";
import {
  filterCommands,
  groupByCategory,
  stepIndex,
  CATEGORY_ORDER,
  type Command,
} from "../../src/utils/commandPalette";

const cmd = (id: string, category: Command["category"], label: string, hint?: string): Command => ({
  id,
  category,
  label,
  hint,
  run: () => {},
});

const sample: Command[] = [
  cmd("t-mon", "tool", "Monitor de servidor"),
  cmd("t-users", "tool", "Usuarios y permisos"),
  cmd("o-orders", "object", "orders", "shop"),
  cmd("o-customers", "object", "customers", "shop"),
  cmd("s-count", "snippet", "contar filas"),
  cmd("h-1", "history", "SELECT * FROM orders", "Demo"),
  cmd("a-new", "action", "Nueva consulta"),
];

describe("filterCommands", () => {
  it("returns all commands in original order for an empty query", () => {
    expect(filterCommands(sample, "").map((c) => c.id)).toEqual(sample.map((c) => c.id));
  });

  it("drops commands that are not a subsequence match", () => {
    const ids = filterCommands(sample, "zzq").map((c) => c.id);
    expect(ids).toEqual([]);
  });

  it("ranks the intended object first for a subsequence query", () => {
    // "order" is a scattered subsequence of several labels, but the contiguous
    // prefix hit on "orders" must rank first.
    const out = filterCommands(sample, "order");
    expect(out[0].id).toBe("o-orders");
    expect(out.map((c) => c.id)).toContain("h-1"); // "SELECT * FROM orders"
  });

  it("ranks a label match above a hint-only match", () => {
    const out = filterCommands(sample, "shop"); // matches object hints only
    expect(out.map((c) => c.id)).toEqual(["o-orders", "o-customers"]);
    // now a query that hits a label should beat a hint hit
    const mixed = filterCommands(
      [cmd("hintonly", "object", "zzz", "alpha"), cmd("labelhit", "tool", "alpha")],
      "alpha",
    );
    expect(mixed[0].id).toBe("labelhit");
  });

  it("ranks a prefix match first", () => {
    const out = filterCommands(sample, "us");
    expect(out[0].id).toBe("t-users"); // "Usuarios..." word-start beats others
  });
});

describe("groupByCategory", () => {
  it("groups in the fixed category order, omitting empty groups", () => {
    const groups = groupByCategory(sample);
    expect(groups.map((g) => g.category)).toEqual(CATEGORY_ORDER);
    // drop objects -> that group disappears, order otherwise preserved
    const noObjects = sample.filter((c) => c.category !== "object");
    expect(groupByCategory(noObjects).map((g) => g.category)).toEqual(
      CATEGORY_ORDER.filter((c) => c !== "object"),
    );
  });

  it("preserves within-group order", () => {
    const tools = groupByCategory(sample).find((g) => g.category === "tool")!;
    expect(tools.items.map((c) => c.id)).toEqual(["t-mon", "t-users"]);
  });
});

describe("stepIndex", () => {
  it("wraps around both ends", () => {
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(1, 1, 3)).toBe(2);
  });
  it("is safe for an empty list", () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});
