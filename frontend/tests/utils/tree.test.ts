import { describe, it, expect } from "vitest";
import {
  isExpandable,
  childKey,
  databaseKey,
  toggleExpanded,
  flattenTree,
  flattenFiltered,
  groupObjectsByType,
  lazyObjectFolders,
  objectLeafNodes,
  type TreeNode,
} from "../../src/utils/tree";
import { translate } from "../../src/utils/i18n";

describe("groupObjectsByType", () => {
  const objs: TreeNode[] = [
    { key: "db:m/tbl:customers", label: "customers", kind: "table", db: "m" },
    { key: "db:m/tbl:orders", label: "orders", kind: "table", db: "m" },
    { key: "db:m/vw:v1", label: "v1", kind: "view", db: "m" },
  ];

  it("splits tables and views into folders with counts + members", () => {
    const { groups, members } = groupObjectsByType("db:m", "m", undefined, objs);
    // g.label holds an i18n key; resolve it through the es catalog to assert text.
    expect(groups.map((g) => [translate("es", g.label), g.kind, g.count])).toEqual([
      ["Tablas", "group", 2],
      ["Vistas", "group", 1],
    ]);
    expect(groups[0].groupKind).toBe("table");
    expect(members["db:m/grp:tbl"].map((n) => n.label)).toEqual(["customers", "orders"]);
    expect(members["db:m/grp:vw"].map((n) => n.label)).toEqual(["v1"]);
  });

  it("omits a folder for a type with no members", () => {
    const onlyTables = objs.filter((n) => n.kind === "table");
    const { groups, members } = groupObjectsByType("db:m", "m", undefined, onlyTables);
    expect(groups.map((g) => translate("es", g.label))).toEqual(["Tablas"]);
    expect(members["db:m/grp:vw"]).toBeUndefined();
  });

  it("group folders are expandable", () => {
    expect(isExpandable("group")).toBe(true);
  });
});

describe("lazyObjectFolders", () => {
  it("builds lazy folder nodes for MySQL under a database", () => {
    const folders = lazyObjectFolders("db:shop", "shop", undefined, "mysql");
    expect(folders.map((f) => translate("es", f.label))).toEqual([
      "Procedimientos",
      "Funciones",
      "Triggers",
      "Eventos",
    ]);
    expect(folders.every((f) => f.kind === "group" && f.lazy === true)).toBe(true);
    expect(folders[0].key).toBe("db:shop/grp:procedure");
  });

  it("is empty for engines without database-level object folders", () => {
    expect(lazyObjectFolders("db:x", "x", undefined, "postgres")).toEqual([]);
  });

  it("lazy folders are expandable (so they can fetch on expand)", () => {
    const [f] = lazyObjectFolders("db:s", "s", undefined, "sqlite");
    expect(isExpandable(f.kind)).toBe(true);
  });
});

describe("objectLeafNodes", () => {
  it("maps leaves to routine/trigger/event nodes with catalog identity", () => {
    const nodes = objectLeafNodes("db:s/grp:procedure", "s", undefined, [
      { name: "add_user", groupKind: "procedure", type: "PROCEDURE", id: "9" },
      { name: "trg", groupKind: "trigger", table: "orders" },
      { name: "ev", groupKind: "event" },
    ]);
    expect(nodes[0]).toMatchObject({
      key: "db:s/grp:procedure/procedure:add_user:9", // id folded in (overloads)
      kind: "routine",
      objType: "PROCEDURE",
      objId: "9",
    });
    expect(nodes[1]).toMatchObject({ kind: "trigger", objTable: "orders" });
    expect(nodes[2].kind).toBe("event");
  });

  it("keeps keys unique for overloaded routines sharing a name (id in the key)", () => {
    // Informix overloads by signature: same procname, distinct procid.
    const nodes = objectLeafNodes("db:s/grp:procedure", "s", undefined, [
      { name: "calc", groupKind: "procedure", id: "7" },
      { name: "calc", groupKind: "procedure", id: "8" },
    ]);
    expect(nodes[0].key).not.toBe(nodes[1].key);
    expect(nodes[0].key).toContain(":7");
    expect(nodes[1].key).toContain(":8");
  });

  it("threads an inline DDL (SQLite trigger) into the leaf node", () => {
    const nodes = objectLeafNodes("db:m/grp:trigger", "m", undefined, [
      { name: "trg", groupKind: "trigger", table: "t", def: "CREATE TRIGGER trg ..." },
    ]);
    expect(nodes[0].objDef).toBe("CREATE TRIGGER trg ...");
  });
});

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

describe("flattenFiltered", () => {
  const roots: TreeNode[] = [{ key: "db:main", label: "main", kind: "database", db: "main" }];
  const children: Record<string, TreeNode[]> = {
    "db:main": [
      { key: "db:main/tbl:users", label: "users", kind: "table", db: "main" },
      { key: "db:main/tbl:orders", label: "orders", kind: "table", db: "main" },
      { key: "db:main/tbl:products", label: "products", kind: "table", db: "main" },
    ],
  };

  it("returns [] for a blank filter", () => {
    expect(flattenFiltered(roots, children, "   ")).toEqual([]);
  });

  it("keeps a match plus its ancestors, force-expanded", () => {
    const flat = flattenFiltered(roots, children, "user");
    expect(flat.map((n) => n.key)).toEqual(["db:main", "db:main/tbl:users"]);
    // The ancestor db is expanded so the match is visible.
    expect(flat[0]).toMatchObject({ key: "db:main", expanded: true });
    expect(flat[1]).toMatchObject({ key: "db:main/tbl:users", depth: 1 });
  });

  it("is case-insensitive and matches multiple leaves", () => {
    const flat = flattenFiltered(roots, children, "S");
    // users, orders, products all contain "s"
    expect(flat.map((n) => n.key)).toEqual([
      "db:main",
      "db:main/tbl:users",
      "db:main/tbl:orders",
      "db:main/tbl:products",
    ]);
  });

  it("returns nothing when there is no match", () => {
    expect(flattenFiltered(roots, children, "zzz")).toEqual([]);
  });

  it("shows a matching container even when no descendant matches", () => {
    const flat = flattenFiltered(roots, children, "main");
    // "main" matches the db itself; no child matches, so it shows alone, collapsed.
    expect(flat.map((n) => n.key)).toEqual(["db:main"]);
    expect(flat[0].expanded).toBe(false);
  });

  it("retains multiple ancestor levels, correctly depth-indexed", () => {
    const roots3: TreeNode[] = [{ key: "db:main", label: "main", kind: "database", db: "main" }];
    const children3: Record<string, TreeNode[]> = {
      "db:main": [
        { key: "db:main/sch:public", label: "public", kind: "schema", db: "main", schema: "public" },
        { key: "db:main/sch:other", label: "other", kind: "schema", db: "main", schema: "other" },
      ],
      "db:main/sch:public": [
        { key: "db:main/sch:public/tbl:invoices", label: "invoices", kind: "table", db: "main", schema: "public" },
      ],
    };
    const flat = flattenFiltered(roots3, children3, "invoic");
    expect(flat.map((n) => [n.key, n.depth])).toEqual([
      ["db:main", 0],
      ["db:main/sch:public", 1],
      ["db:main/sch:public/tbl:invoices", 2],
    ]);
    // The non-matching sibling schema is dropped.
    expect(flat.some((n) => n.key === "db:main/sch:other")).toBe(false);
    expect(flat[0].expanded).toBe(true);
    expect(flat[1].expanded).toBe(true);
  });

  it("only considers already-loaded children (lazy folders never fetch)", () => {
    // A lazy folder whose members are not in childrenByKey: only its own label
    // can match; its (unloaded) contents are never inspected.
    const withLazy: Record<string, TreeNode[]> = {
      "db:main": [
        { key: "db:main/grp:procedure", label: "Procedimientos", kind: "group", db: "main", groupKind: "procedure", lazy: true },
      ],
    };
    expect(flattenFiltered(roots, withLazy, "proc").map((n) => n.key)).toEqual([
      "db:main",
      "db:main/grp:procedure",
    ]);
    // A filter matching a not-yet-loaded routine finds nothing (no fetch).
    expect(flattenFiltered(roots, withLazy, "get_total")).toEqual([]);
  });
});
