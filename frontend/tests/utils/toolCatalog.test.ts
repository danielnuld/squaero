import { describe, it, expect } from "vitest";
import { TOOL_CATALOG } from "../../src/utils/toolCatalog";

describe("TOOL_CATALOG", () => {
  it("has a unique key + tool per entry and all display fields", () => {
    const keys = TOOL_CATALOG.map((t) => t.key);
    const tools = TOOL_CATALOG.map((t) => t.tool);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(tools).size).toBe(tools.length);
    for (const t of TOOL_CATALOG) {
      // The icon is a component now, not an emoji string: every surface that shows
      // one (the ribbon, the tree's tools menu) renders it, so a missing one would
      // leave a hole rather than fall back to text.
      expect(typeof t.Icon).toBe("function");
      expect(t.label).toBeTruthy();
      expect(t.tabTitle).toBeTruthy();
      expect(t.title).toBeTruthy();
    }
  });
});
