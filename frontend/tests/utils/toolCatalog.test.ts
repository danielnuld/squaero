import { describe, it, expect } from "vitest";
import { TOOL_CATALOG } from "../../src/utils/toolCatalog";

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
