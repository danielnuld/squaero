import { describe, it, expect } from "vitest";
import {
  isExpandable,
  childKey,
  databaseKey,
  toggleExpanded,
  flattenTree,
  type TreeNode,
} from "../../src/utils/tree";

describe("isExpandable", () => {
  it("containers expand, leaves do not", () => {
    expect(isExpandable("database")).toBe(true);
    expect(isExpandable("schema")).toBe(true);
    expect(isExpandable("table")).toBe(false);
    expect(isExpandable("view")).toBe(false);
  });
});

describe("key helpers", () => {
  it("builds stable nested keys", () => {
    expect(databaseKey("main")).toBe("db:main");
    expect(childKey("db:main", "table", "users")).toBe("db:main/tbl:users");
    expect(childKey("db:main", "schema", "public")).toBe("db:main/sch:public");
  });

  it("gives tables and views distinct keys so same-named objects don't collide", () => {
    expect(childKey("db:main", "view", "foo")).toBe("db:main/vw:foo");
    expect(childKey("db:main", "table", "foo")).not.toBe(childKey("db:main", "view", "foo"));
  });
});

describe("toggleExpanded", () => {
  it("adds then removes a key without mutating the input", () => {
    const a = new Set<string>();
    const b = toggleExpanded(a, "db:main");
    expect(a.has("db:main")).toBe(false); // input untouched
    expect(b.has("db:main")).toBe(true);
    const c = toggleExpanded(b, "db:main");
    expect(c.has("db:main")).toBe(false);
  });
});

describe("flattenTree", () => {
  const roots: TreeNode[] = [{ key: "db:main", label: "main", kind: "database", db: "main" }];
  const children: Record<string, TreeNode[]> = {
    "db:main": [
      { key: "db:main/tbl:users", label: "users", kind: "table", db: "main" },
      { key: "db:main/tbl:orders", label: "orders", kind: "table", db: "main" },
    ],
  };

  it("shows only roots when nothing is expanded", () => {
    const flat = flattenTree(roots, children, new Set());
    expect(flat.map((n) => n.key)).toEqual(["db:main"]);
    expect(flat[0]).toMatchObject({ depth: 0, expandable: true, expanded: false });
  });

  it("includes children of expanded containers with incremented depth", () => {
    const flat = flattenTree(roots, children, new Set(["db:main"]));
    expect(flat.map((n) => n.key)).toEqual([
      "db:main",
      "db:main/tbl:users",
      "db:main/tbl:orders",
    ]);
    expect(flat[0].expanded).toBe(true);
    expect(flat[1]).toMatchObject({ depth: 1, expandable: false });
  });

  it("expanded container with no loaded children contributes only itself", () => {
    const flat = flattenTree(roots, {}, new Set(["db:main"]));
    expect(flat.map((n) => n.key)).toEqual(["db:main"]);
    expect(flat[0].expanded).toBe(true);
  });

  it("does not recurse into an expanded leaf-less collapsed child", () => {
    const nested: Record<string, TreeNode[]> = {
      "db:main": [{ key: "db:main/sch:public", label: "public", kind: "schema", db: "main" }],
      "db:main/sch:public": [{ key: "db:main/sch:public/tbl:t", label: "t", kind: "table", db: "main", schema: "public" }],
    };
    // main expanded, public collapsed -> public shown, its table hidden
    const flat = flattenTree(roots, nested, new Set(["db:main"]));
    expect(flat.map((n) => n.key)).toEqual(["db:main", "db:main/sch:public"]);
  });
});
