import { describe, it, expect } from "vitest";
import { hiddenTabs, tabIcon } from "../../src/utils/tabStrip";

describe("tabIcon", () => {
  it("shows a table for a data tab and a query for any other query tab", () => {
    expect(tabIcon({ kind: "query" }, true)).toBe("table");
    expect(tabIcon({ kind: "query" }, false)).toBe("query");
  });

  it("gives known tools their own icon", () => {
    expect(tabIcon({ kind: "tool", tool: "settings" }, false)).toBe("settings");
    expect(tabIcon({ kind: "tool", tool: "snippets" }, false)).toBe("bookmark");
    expect(tabIcon({ kind: "tool", tool: "connections" }, false)).toBe("plug");
  });

  it("falls back to the generic tool icon for any other tool", () => {
    expect(tabIcon({ kind: "tool", tool: "monitor" }, false)).toBe("tools");
    expect(tabIcon({ kind: "tool" }, true)).toBe("tools");
  });
});

describe("hiddenTabs", () => {
  const tabs = [
    { left: 0, right: 100 },
    { left: 100, right: 200 },
    { left: 200, right: 300 },
  ];

  it("lists nothing when every tab fits", () => {
    expect(hiddenTabs(tabs, { left: 0, right: 300 })).toEqual([]);
  });

  it("counts a tab cut by either edge as hidden", () => {
    expect(hiddenTabs(tabs, { left: 50, right: 250 })).toEqual([0, 2]);
  });

  it("tolerates sub-pixel edges", () => {
    expect(hiddenTabs(tabs, { left: 0.3, right: 299.6 })).toEqual([]);
  });

  it("hides nothing before the strip has a width", () => {
    expect(hiddenTabs(tabs, { left: 0, right: 0 })).toEqual([]);
    expect(hiddenTabs([], { left: 0, right: 300 })).toEqual([]);
  });
});
