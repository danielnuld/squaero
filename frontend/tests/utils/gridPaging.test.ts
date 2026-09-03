import { describe, it, expect } from "vitest";
import {
  nextOffset,
  pageHasMore,
  refreshAction,
  refreshBlock,
} from "../../src/utils/gridPaging";

describe("nextOffset", () => {
  it("steps forward and back by the page size", () => {
    expect(nextOffset(0, 1, 1000)).toBe(1000);
    expect(nextOffset(1000, 1, 1000)).toBe(2000);
    expect(nextOffset(2000, -1, 1000)).toBe(1000);
  });

  it("clamps to zero (never a negative offset)", () => {
    expect(nextOffset(0, -1, 1000)).toBe(0);
    expect(nextOffset(500, -1, 1000)).toBe(0);
  });

  it("floors fractional inputs and treats size < 1 as 1", () => {
    expect(nextOffset(10.9, 1, 100.5)).toBe(110);
    expect(nextOffset(0, 1, 0)).toBe(1);
  });
});

describe("pageHasMore", () => {
  it("is true only when a full page came back", () => {
    expect(pageHasMore(1000, 1000)).toBe(true);
    expect(pageHasMore(1001, 1000)).toBe(true);
    expect(pageHasMore(999, 1000)).toBe(false);
    expect(pageHasMore(0, 1000)).toBe(false);
  });
});

describe("refreshAction", () => {
  it("re-runs the SQL that produced the page, not the editor's text", () => {
    expect(refreshAction({ pageSql: "SELECT * FROM users", offset: 0 })).toEqual({
      kind: "query",
      sql: "SELECT * FROM users",
      offset: 0,
    });
  });

  it("keeps the current page", () => {
    expect(refreshAction({ pageSql: "SELECT * FROM users", offset: 2000 })).toEqual({
      kind: "query",
      sql: "SELECT * FROM users",
      offset: 2000,
    });
  });

  it("sends a table preview through the preview path, at its page", () => {
    const r = { pageSql: "SELECT FIRST 1000 SKIP 1000 * FROM users", offset: 1000, preview: {} };
    expect(refreshAction(r)).toEqual({ kind: "preview", offset: 1000 });
  });

  it("does nothing when the tab has never run a query", () => {
    expect(refreshAction(undefined)).toBeNull();
    expect(refreshAction({})).toBeNull();
    // An error left the tab with no page: there is nothing on screen to refresh.
    expect(refreshAction({ offset: 0 })).toBeNull();
  });
});

describe("refreshBlock", () => {
  const page = { pageSql: "SELECT * FROM users", offset: 0 };
  const idle = { editing: false, loading: false };

  it("lets a displayed page be re-run", () => {
    expect(refreshBlock(page, idle)).toBeNull();
  });

  it("refuses while an edit session is open — refreshing would drop the changes", () => {
    expect(refreshBlock(page, { editing: true, loading: false })).toBe("editing");
  });

  it("refuses while the query is still running, so a second click cannot stack a run", () => {
    expect(refreshBlock(page, { editing: false, loading: true })).toBe("running");
  });

  it("refuses when the tab has nothing on screen to re-run", () => {
    expect(refreshBlock(undefined, idle)).toBe("nothing");
    expect(refreshBlock({}, idle)).toBe("nothing");
  });

  it("reports the edit session first: it is the reason the user can act on", () => {
    expect(refreshBlock(undefined, { editing: true, loading: true })).toBe("editing");
  });
});
