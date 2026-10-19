import { describe, it, expect } from "vitest";
import { toolbarLayout, type ToolbarState } from "../../src/utils/objectToolbar";

const base: ToolbarState = {
  isTable: true,
  hasColumns: true,
  editable: true,
  readOnly: false,
  canFilter: true,
  canTranspose: true,
  canPin: true,
  canCompare: true,
};

describe("toolbarLayout", () => {
  it("lays out a browsed, editable table", () => {
    expect(toolbarLayout(base)).toEqual({
      main: ["refresh", "filter", "sort", "search", "addRow"],
      side: ["transpose", "pin", "compare", "chart", "export"],
      more: ["import", "generate", "transfer", "syncSchema", "syncData"],
    });
  });

  it("keeps everything that writes away from a read-only connection", () => {
    const l = toolbarLayout({ ...base, readOnly: true });
    expect(l.main).not.toContain("addRow");
    expect(l.more).not.toContain("import");
    expect(l.more).not.toContain("generate");
    // Reading is still fine: transfer and the structure sync start from here.
    expect(l.more).toContain("transfer");
  });

  it("offers no new row and no data sync without a primary key", () => {
    const l = toolbarLayout({ ...base, editable: false });
    expect(l.main).not.toContain("addRow");
    expect(l.more).toEqual(["import", "generate", "transfer", "syncSchema"]);
  });

  it("gives a query result its tools but no table actions", () => {
    const l = toolbarLayout({ ...base, isTable: false, canFilter: false });
    expect(l.main).toEqual(["refresh", "search"]);
    expect(l.side).toEqual(["transpose", "pin", "compare", "chart", "export"]);
    expect(l.more).toEqual([]);
  });

  it("leaves out the optional tools the workspace does not offer", () => {
    const l = toolbarLayout({ ...base, canTranspose: false, canPin: false, canCompare: false });
    expect(l.side).toEqual(["chart", "export"]);
  });

  it("offers only the refresh for a result without columns", () => {
    const l = toolbarLayout({ ...base, isTable: false, hasColumns: false, canFilter: false });
    expect(l).toEqual({ main: ["refresh"], side: [], more: [] });
  });
});
