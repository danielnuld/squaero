import { describe, it, expect } from "vitest";
import {
  nextTabId,
  addTab,
  openTool,
  openSnippetTab,
  closeTab,
  closeOtherTabs,
  updateTabSql,
  activeTab,
  serializeWorkspace,
  parseWorkspace,
  objectTabKey,
  findObjectTab,
  setObjectKey,
  MAX_RESTORED_TABS,
  type TabState,
} from "../../src/utils/tabs";

const empty: TabState = { tabs: [], activeId: 0 };

describe("nextTabId", () => {
  it("starts at 1 for an empty list", () => {
    expect(nextTabId([])).toBe(1);
  });

  it("is one past the highest existing id", () => {
    expect(
      nextTabId([
        { id: 3, kind: "query", title: "a", sql: "" },
        { id: 7, kind: "query", title: "b", sql: "" },
      ]),
    ).toBe(8);
  });
});

describe("openTool", () => {
  it("appends a new active tool tab", () => {
    const s = openTool(empty, "monitor", "Monitor de servidor", { key: "monitor" });
    expect(s.tabs).toHaveLength(1);
    const tab = s.tabs[0];
    expect(tab.kind).toBe("tool");
    expect(tab).toMatchObject({ tool: "monitor", title: "Monitor de servidor", key: "monitor" });
    expect(s.activeId).toBe(tab.id);
  });

  it("focuses an existing tool tab with the same tool+key instead of duplicating", () => {
    let s = openTool(empty, "monitor", "Monitor", { key: "monitor" });
    s = addTab(s); // a query tab in between, now active
    const reopened = openTool(s, "monitor", "Monitor", { key: "monitor" });
    expect(reopened.tabs).toHaveLength(2); // no duplicate
    expect(reopened.activeId).toBe(s.tabs[0].id); // focused the monitor tab
  });

  it("opens distinct tabs for different keys", () => {
    let s = openTool(empty, "generator", "Generar · a", { key: "gen:a" });
    s = openTool(s, "generator", "Generar · b", { key: "gen:b" });
    expect(s.tabs).toHaveLength(2);
  });
});

describe("openSnippetTab", () => {
  const snip = { id: "snip-1", name: "facturas impagadas", body: "SELECT * FROM facturas" };
  const other = { id: "snip-2", name: "clientes", body: "SELECT * FROM clientes" };

  it("opens the snippet in a query tab of its own, named after it", () => {
    const s = openSnippetTab(empty, snip, "conn-1");
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toEqual({
      id: 1,
      kind: "query",
      title: "facturas impagadas", // its own name, not "Consulta 1"
      sql: "SELECT * FROM facturas",
      connDefId: "conn-1",
      snippetId: "snip-1",
    });
    expect(s.activeId).toBe(1);
  });

  it("focuses the tab a snippet already has instead of opening a second one", () => {
    let s = openSnippetTab(empty, snip);
    s = addTab(s); // the user moved on to another query, now active
    const reopened = openSnippetTab(s, snip);
    expect(reopened.tabs).toHaveLength(2); // no duplicate
    expect(reopened.activeId).toBe(1);
  });

  it("gives each snippet its own tab", () => {
    let s = openSnippetTab(empty, snip);
    s = openSnippetTab(s, other);
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs.map((t) => t.kind === "query" && t.snippetId)).toEqual(["snip-1", "snip-2"]);
  });

  it("leaves the text of every other tab untouched", () => {
    let s = addTab(empty);
    s = updateTabSql(s, 1, "SELECT lo_que_estaba_escribiendo");
    s = openSnippetTab(s, snip);
    const untouched = s.tabs.find((t) => t.id === 1);
    expect(untouched).toMatchObject({ sql: "SELECT lo_que_estaba_escribiendo" });
  });

  it("reuses the tab only when the snippet matches, not any tab without one", () => {
    // A plain query tab has no snippetId; it must never be mistaken for one.
    const s = openSnippetTab(addTab(empty), snip);
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(2);
  });
});

describe("addTab", () => {
  it("appends a new active tab", () => {
    const s1 = addTab(empty);
    expect(s1.tabs).toHaveLength(1);
    expect(s1.activeId).toBe(s1.tabs[0].id);
    const s2 = addTab(s1);
    expect(s2.tabs).toHaveLength(2);
    expect(s2.activeId).toBe(s2.tabs[1].id);
    expect(s2.tabs[1].id).not.toBe(s2.tabs[0].id);
  });

  it("numbers generic titles but keeps an object name as-is", () => {
    expect(addTab(empty, "Consulta").tabs[0].title).toBe("Consulta 1");
    expect(addTab(empty, "clientes", undefined, false).tabs[0].title).toBe("clientes");
  });
});

describe("closeTab", () => {
  it("is a no-op for an unknown id", () => {
    const s1 = addTab(empty);
    expect(closeTab(s1, 999)).toEqual(s1);
  });

  it("selects the previous tab when closing the active one", () => {
    let s = addTab(empty); // tab 1
    s = addTab(s); // tab 2
    s = addTab(s); // tab 3 (active)
    const closed = closeTab(s, 3);
    expect(closed.tabs.map((t) => t.id)).toEqual([1, 2]);
    expect(closed.activeId).toBe(2);
  });

  it("selects the next tab when closing the active first tab", () => {
    let s = addTab(empty); // 1 (active)
    s = addTab(s); // 2
    s = { ...s, activeId: 1 };
    const closed = closeTab(s, 1);
    expect(closed.activeId).toBe(2);
  });

  it("keeps the active id when closing a non-active tab", () => {
    let s = addTab(empty); // 1
    s = addTab(s); // 2 (active)
    const closed = closeTab(s, 1);
    expect(closed.activeId).toBe(2);
  });

  it("empties out when closing the last tab", () => {
    const s = addTab(empty);
    expect(closeTab(s, s.activeId)).toMatchObject({ tabs: [], activeId: 0 });
  });

  // The app keys per-tab state (results, filters, columns) by tab id: a recycled
  // id made a new tab open showing the closed tab's grid, and a closed TABLE's id
  // made it open as a filter panel with no editor at all.
  it("never reuses the id of a closed tab", () => {
    let s = addTab(empty); // 1
    s = addTab(s); // 2
    s = closeTab(s, 2);
    s = addTab(s);
    expect(s.activeId).toBe(3);
    s = closeTab(closeTab(s, 3), 1); // back to no tabs at all
    expect(addTab(s).activeId).toBe(4);
    expect(openTool(s, "monitor", "Monitor").activeId).toBe(4);
    expect(
      openSnippetTab(s, { id: "snip-1", name: "n", body: "" }).activeId,
    ).toBe(4);
  });
});

describe("closeOtherTabs", () => {
  it("keeps only the given tab and makes it active", () => {
    let s = addTab(addTab(addTab(empty))); // tabs 1,2,3, active 3
    s = closeOtherTabs(s, 2);
    expect(s.tabs.map((t) => t.id)).toEqual([2]);
    expect(s.activeId).toBe(2);
  });

  it("is a no-op for an unknown id", () => {
    const s = addTab(addTab(empty));
    expect(closeOtherTabs(s, 999)).toEqual(s);
  });
});

describe("updateTabSql", () => {
  it("replaces only the targeted tab's sql", () => {
    let s = addTab(empty); // 1
    s = addTab(s); // 2
    const updated = updateTabSql(s, 1, "SELECT 1");
    const t1 = updated.tabs.find((t) => t.id === 1);
    expect(t1?.kind === "query" && t1.sql).toBe("SELECT 1");
  });

  it("leaves a tool tab untouched", () => {
    const s = openTool(empty, "monitor", "Monitor", { key: "m" });
    const updated = updateTabSql(s, s.tabs[0].id, "SELECT 1");
    expect(updated.tabs[0]).not.toHaveProperty("sql");
  });
});

describe("activeTab", () => {
  it("returns the active tab or undefined", () => {
    expect(activeTab(empty)).toBeUndefined();
    const s = addTab(empty);
    expect(activeTab(s)?.id).toBe(s.activeId);
  });
});

// The workspace survives a restart (issue #401): what a crash takes is the query
// you had not run yet, and the history only keeps what was executed.
describe("workspace persistence", () => {
  const roundTrip = (state: TabState) => parseWorkspace(serializeWorkspace(state));

  it("brings back the tabs, their sql and which one was active", () => {
    let s = addTab(empty, "uno", undefined, false);
    s = updateTabSql(s, 1, "SELECT 1");
    s = addTab(s, "dos", undefined, false);
    s = updateTabSql(s, 2, "SELECT * FROM sin_ejecutar");
    s = { ...s, activeId: 1 };

    const back = roundTrip(s)!;
    expect(back.tabs.map((t) => t.title)).toEqual(["uno", "dos"]);
    expect(back.tabs.map((t) => (t.kind === "query" ? t.sql : null))).toEqual([
      "SELECT 1",
      "SELECT * FROM sin_ejecutar",
    ]);
    expect(back.activeId).toBe(1);
  });

  it("keeps the connection and snippet a tab was bound to", () => {
    let s = addTab(empty, "prod", "conn-7");
    s = openSnippetTab(s, { id: "snip-3", name: "Ventas", body: "SELECT 1" });
    const back = roundTrip(s)!;
    expect(back.tabs[0]).toMatchObject({ connDefId: "conn-7" });
    expect(back.tabs[1]).toMatchObject({ snippetId: "snip-3" });
  });

  it("drops tool tabs: the panel would come back with nothing behind it", () => {
    let s = addTab(empty, "consulta");
    s = openTool(s, "monitor", "Monitor", { key: "m" });
    const back = roundTrip(s)!;
    expect(back.tabs).toHaveLength(1);
    expect(back.tabs[0].kind).toBe("query");
  });

  it("falls back to a real tab when the active one was a tool tab", () => {
    let s = addTab(empty, "consulta");
    s = openTool(s, "monitor", "Monitor", { key: "m" });
    expect(s.activeId).toBe(2); // the tool tab took focus
    const back = roundTrip(s)!;
    expect(back.activeId).toBe(1);
  });

  it("never hands ids back out: seq survives the restart", () => {
    // Ids are not recycled because per-tab state is keyed by them (issue #355).
    let s = addTab(empty, "uno"); // 1
    s = addTab(s, "dos"); // 2
    s = closeTab(s, 2); // seq stays at 2
    const back = roundTrip(s)!;
    expect(back.seq).toBe(2);
    expect(addTab(back, "tres").tabs.at(-1)!.id).toBe(3);
  });

  it("raises seq to the highest id restored even if the stored counter lied", () => {
    const forged = JSON.stringify({
      tabs: [{ id: 9, kind: "query", title: "t", sql: "" }],
      activeId: 9,
      seq: 1,
    });
    expect(parseWorkspace(forged)!.seq).toBe(9);
  });

  it("returns null for nothing usable, so the app opens its normal first tab", () => {
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace("")).toBeNull();
    expect(parseWorkspace("not json")).toBeNull();
    expect(parseWorkspace("[]")).toBeNull();
    expect(parseWorkspace(JSON.stringify({ tabs: "nope" }))).toBeNull();
    // A workspace of tool tabs only leaves nothing to restore.
    expect(parseWorkspace(serializeWorkspace(openTool(empty, "monitor", "M")))).toBeNull();
  });

  it("skips malformed tabs and duplicate ids instead of failing the whole load", () => {
    const mixed = JSON.stringify({
      tabs: [
        { id: 1, kind: "query", title: "ok", sql: "SELECT 1" },
        { id: 2, kind: "query", title: "sin sql" },
        { id: "x", kind: "query", title: "id malo", sql: "" },
        { id: 1, kind: "query", title: "id repetido", sql: "" },
      ],
      activeId: 1,
      seq: 4,
    });
    const back = parseWorkspace(mixed)!;
    expect(back.tabs.map((t) => t.title)).toEqual(["ok"]);
  });

  it("caps how many tabs come back, keeping the most recent", () => {
    let s: TabState = empty;
    for (let i = 0; i < MAX_RESTORED_TABS + 5; i++) s = addTab(s, `t${i}`, undefined, false);
    const back = roundTrip(s)!;
    expect(back.tabs).toHaveLength(MAX_RESTORED_TABS);
    expect(back.tabs.at(-1)!.title).toBe(`t${MAX_RESTORED_TABS + 4}`);
  });
});

// Clicking a table in the tree twice used to stack a second tab with the same
// name (issue #414). One tab per object, the way there is one per snippet.
describe("object tabs", () => {
  const key = (over: Partial<Parameters<typeof objectTabKey>[0]> = {}) =>
    objectTabKey({ connDefId: "c1", db: "midb", name: "clientes", kind: "data", ...over });

  it("separates what genuinely is a different object", () => {
    const base = key();
    expect(key({ connDefId: "c2" })).not.toBe(base); // same table, other connection
    expect(key({ db: "otra" })).not.toBe(base);
    expect(key({ schema: "ventas" })).not.toBe(base);
    expect(key({ name: "pedidos" })).not.toBe(base);
    expect(key({ kind: "def:view" })).not.toBe(base); // rows vs definition
  });

  it("is the same key for the same object", () => {
    expect(key()).toBe(key());
  });

  it("does not collide when a name contains the separator's neighbours", () => {
    // The parts are joined, so two different splits must not meet in the middle.
    expect(objectTabKey({ db: "a", name: "b", kind: "data" })).not.toBe(
      objectTabKey({ db: "", name: "a.b", kind: "data" }),
    );
  });

  it("finds the tab already open for an object, and only a query tab", () => {
    let s = addTab(empty, "clientes", "c1", false);
    s = setObjectKey(s, 1, key());
    expect(findObjectTab(s, key())?.id).toBe(1);
    expect(findObjectTab(s, key({ name: "pedidos" }))).toBeUndefined();
    // A tool tab never carries one.
    const withTool = openTool(s, "monitor", "Monitor", { key: "m" });
    expect(findObjectTab(withTool, key())?.id).toBe(1);
  });

  it("leaves the rest of the tab untouched when tagging it", () => {
    let s = addTab(empty, "clientes", "c1", false);
    s = updateTabSql(s, 1, "SELECT * FROM clientes");
    s = setObjectKey(s, 1, key());
    const tab = s.tabs[0];
    expect(tab.kind === "query" && tab.sql).toBe("SELECT * FROM clientes");
    expect(tab.title).toBe("clientes");
  });

  it("survives the restart, or the duplicate comes back", () => {
    // The workspace is what a restart restores (#401); an identity that did not
    // travel with it would make the first click on an already-open table
    // duplicate again.
    let s = addTab(empty, "clientes", "c1", false);
    s = setObjectKey(s, 1, key());
    const back = parseWorkspace(serializeWorkspace(s))!;
    expect(findObjectTab(back, key())?.id).toBe(1);
  });
});
