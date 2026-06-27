import { describe, it, expect } from "vitest";
import {
  nextTabId,
  addTab,
  closeTab,
  updateTabSql,
  activeTab,
  type TabState,
} from "../../src/utils/tabs";

const empty: TabState = { tabs: [], activeId: 0 };

describe("nextTabId", () => {
  it("starts at 1 for an empty list", () => {
    expect(nextTabId([])).toBe(1);
  });

  it("is one past the highest existing id", () => {
    expect(nextTabId([{ id: 3, title: "a", sql: "" }, { id: 7, title: "b", sql: "" }])).toBe(8);
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
    expect(closeTab(s, s.activeId)).toEqual({ tabs: [], activeId: 0 });
  });
});

describe("updateTabSql", () => {
  it("replaces only the targeted tab's sql", () => {
    let s = addTab(empty); // 1
    s = addTab(s); // 2
    const updated = updateTabSql(s, 1, "SELECT 1");
    expect(updated.tabs.find((t) => t.id === 1)?.sql).toBe("SELECT 1");
    expect(updated.tabs.find((t) => t.id === 2)?.sql).toBe("");
  });
});

describe("activeTab", () => {
  it("returns the active tab or undefined", () => {
    expect(activeTab(empty)).toBeUndefined();
    const s = addTab(empty);
    expect(activeTab(s)?.id).toBe(s.activeId);
  });
});
