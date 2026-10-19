import { describe, it, expect } from "vitest";
import { statusItems, type StatusFacts } from "../../src/utils/statusBar";

const all: StatusFacts = {
  hasObject: true,
  hasScope: true,
  rows: 12,
  columns: 7,
  marked: 2,
  hasSummary: true,
  elapsedMs: 20,
  hasCursor: true,
};

const none: StatusFacts = {
  hasObject: false,
  hasScope: false,
  rows: null,
  columns: null,
  marked: 0,
  hasSummary: false,
  elapsedMs: null,
  hasCursor: false,
};

describe("statusItems", () => {
  it("gives a query tab what ran and where the cursor is, in reading order", () => {
    expect(statusItems("query", all)).toEqual([
      "scope",
      "rows",
      "columns",
      "marked",
      "summary",
      "duration",
      "cursor",
    ]);
  });

  it("gives a table tab its object, never a run scope or a cursor", () => {
    expect(statusItems("data", all)).toEqual([
      "object",
      "rows",
      "columns",
      "marked",
      "summary",
      "duration",
    ]);
  });

  it("says nothing for a tool tab or with no tab open", () => {
    expect(statusItems("tool", all)).toEqual([]);
    expect(statusItems("none", all)).toEqual([]);
  });

  it("leaves out what is not there", () => {
    expect(statusItems("query", none)).toEqual([]);
    expect(statusItems("query", { ...none, hasCursor: true })).toEqual(["cursor"]);
  });

  it("shows zero rows (an empty result is a fact) but not zero marks", () => {
    expect(statusItems("data", { ...none, rows: 0, columns: 3, marked: 0 })).toEqual([
      "rows",
      "columns",
    ]);
  });
});
