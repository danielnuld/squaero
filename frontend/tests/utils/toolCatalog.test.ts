import { describe, it, expect } from "vitest";
import { TOOL_CATALOG, TOOL_GROUPS, toolUnsupported, toolsByGroup } from "../../src/utils/toolCatalog";

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

const tool = (k: string) => TOOL_CATALOG.find((x) => x.tool === k)!;

describe("toolUnsupported (audit A-18)", () => {
  it("names why SQLite cannot run the server tools", () => {
    for (const k of ["monitor", "slowQueries", "users", "routines"])
      expect(toolUnsupported(tool(k), "sqlite"), k).toMatch(/\S/);
  });

  it("is null for what every engine runs, and for a supported engine", () => {
    expect(toolUnsupported(tool("erDiagram"), "sqlite")).toBeNull();
    expect(toolUnsupported(tool("monitor"), "postgres")).toBeNull();
    expect(toolUnsupported(tool("users"), "mysql")).toBeNull();
    expect(toolUnsupported(tool("triggers"), "sqlite")).toBeNull();
  });

  it("refuses nothing before an engine is known", () => {
    for (const x of TOOL_CATALOG) expect(toolUnsupported(x, undefined)).toBeNull();
  });

  it("refuses triggers on MongoDB", () => {
    expect(toolUnsupported(tool("triggers"), "mongodb")).toMatch(/\S/);
  });
});

describe("toolsByGroup", () => {
  it("lists every tool once, groups in order, the ungrouped last", () => {
    const groups = toolsByGroup();
    expect(groups.flatMap((g) => g.tools)).toHaveLength(TOOL_CATALOG.length);
    expect(groups.map((g) => g.group)).toEqual([...TOOL_GROUPS, null]);
    expect(groups.at(-1)!.tools.map((x) => x.tool)).toEqual(["connections"]);
    expect(groups.find((g) => g.group === "server")!.tools.map((x) => x.tool)).toEqual([
      "monitor",
      "slowQueries",
      "users",
    ]);
  });
});
