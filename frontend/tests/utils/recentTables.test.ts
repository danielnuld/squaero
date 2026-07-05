import { describe, it, expect } from "vitest";
import { pushRecent, DEFAULT_RECENT_MAX } from "../../src/utils/recentTables";
import type { TreeNode } from "../../src/utils/tree";

const tbl = (key: string, label = key, kind: TreeNode["kind"] = "table"): TreeNode => ({
  key,
  label,
  kind,
});

describe("pushRecent", () => {
  it("prepends the newest node", () => {
    const out = pushRecent([tbl("a")], tbl("b"));
    expect(out.map((n) => n.key)).toEqual(["b", "a"]);
  });

  it("dedupes by stable key, moving a repeat to the front", () => {
    const out = pushRecent([tbl("a"), tbl("b")], tbl("a"));
    expect(out.map((n) => n.key)).toEqual(["a", "b"]);
    expect(out).toHaveLength(2);
  });

  it("caps the list length", () => {
    let list: TreeNode[] = [];
    for (let i = 0; i < DEFAULT_RECENT_MAX + 3; i++) list = pushRecent(list, tbl(`t${i}`));
    expect(list).toHaveLength(DEFAULT_RECENT_MAX);
    // The most recent is first.
    expect(list[0].key).toBe(`t${DEFAULT_RECENT_MAX + 2}`);
  });

  it("accepts a view and ignores non-table/view nodes", () => {
    expect(pushRecent([], tbl("v", "v", "view")).map((n) => n.key)).toEqual(["v"]);
    const before = [tbl("a")];
    expect(pushRecent(before, tbl("db", "db", "database"))).toBe(before);
    expect(pushRecent(before, tbl("g", "Tablas", "group"))).toBe(before);
  });

  it("does not mutate the input list", () => {
    const before = [tbl("a")];
    pushRecent(before, tbl("b"));
    expect(before.map((n) => n.key)).toEqual(["a"]);
  });
});
