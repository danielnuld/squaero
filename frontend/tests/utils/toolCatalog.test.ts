import { describe, it, expect, beforeEach, vi } from "vitest";
import { TOOL_CATALOG } from "../../src/utils/toolCatalog";

const KEY = "quaero.tools.collapsed";

async function fresh() {
  return import("../../src/utils/toolCatalog");
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe("TOOL_CATALOG", () => {
  it("has a unique key + tool per entry and all display fields", () => {
    const keys = TOOL_CATALOG.map((t) => t.key);
    const tools = TOOL_CATALOG.map((t) => t.tool);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(tools).size).toBe(tools.length);
    for (const t of TOOL_CATALOG) {
      expect(t.icon).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.tabTitle).toBeTruthy();
      expect(t.title).toBeTruthy();
    }
  });
});

describe("collapsed persistence", () => {
  it("defaults to expanded (false) when nothing stored", async () => {
    const { loadToolsCollapsed } = await fresh();
    expect(loadToolsCollapsed()).toBe(false);
  });

  it("round-trips the collapsed flag", async () => {
    const { loadToolsCollapsed, saveToolsCollapsed } = await fresh();
    saveToolsCollapsed(true);
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(loadToolsCollapsed()).toBe(true);
    saveToolsCollapsed(false);
    expect(loadToolsCollapsed()).toBe(false);
  });

  it("treats any non-\"1\" stored value as not collapsed", async () => {
    localStorage.setItem(KEY, "true"); // only exactly "1" means collapsed
    const { loadToolsCollapsed } = await fresh();
    expect(loadToolsCollapsed()).toBe(false);
  });
});
