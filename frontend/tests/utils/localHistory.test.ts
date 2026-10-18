import { describe, it, expect } from "vitest";
import {
  recordVersion,
  pruneHistory,
  parseLocalHistory,
  serializeLocalHistory,
  MAX_VERSION_CHARS,
  type Retention,
  type TabHistory,
} from "../../src/utils/localHistory";

const DAY = 86_400_000;
const keep: Retention = { maxVersions: 50, maxDays: 0 };
const tab = (sql: string, id = 1, title = "Consulta 1") => ({ id, title, sql });

describe("recordVersion", () => {
  it("adds a version newest first, with its reason and time", () => {
    let r = recordVersion([], tab("SELECT 1"), "run", 10, keep);
    expect(r.outcome).toBe("recorded");
    r = recordVersion(r.list, tab("SELECT 2"), "auto", 20, keep);
    expect(r.list).toEqual([
      {
        tabId: 1,
        title: "Consulta 1",
        versions: [
          { ts: 20, reason: "auto", sql: "SELECT 2" },
          { ts: 10, reason: "run", sql: "SELECT 1" },
        ],
      },
    ]);
  });

  it("skips a text identical to the tab's latest version (whatever the reason)", () => {
    const first = recordVersion([], tab("SELECT 1"), "auto", 10, keep);
    const again = recordVersion(first.list, tab("SELECT 1"), "run", 20, keep);
    expect(again.outcome).toBe("unchanged");
    expect(again.list).toBe(first.list);
  });

  it("keeps an older identical text when it is not the latest (A, B, A)", () => {
    let list: TabHistory[] = [];
    for (const [i, sql] of ["A", "B", "A"].entries()) {
      list = recordVersion(list, tab(sql), "auto", i, keep).list;
    }
    expect(list[0].versions.map((v) => v.sql)).toEqual(["A", "B", "A"]);
  });

  it("does not record blank text", () => {
    expect(recordVersion([], tab("   \n"), "auto", 1, keep).outcome).toBe("blank");
    expect(recordVersion([], tab(""), "run", 1, keep).list).toEqual([]);
  });

  it("refuses a version over the size cap and says so (no truncation)", () => {
    const big = "x".repeat(MAX_VERSION_CHARS + 1);
    const r = recordVersion([], tab(big), "auto", 1, keep);
    expect(r.outcome).toBe("tooBig");
    expect(r.list).toEqual([]);
    expect(recordVersion([], tab("x".repeat(MAX_VERSION_CHARS)), "auto", 1, keep).outcome).toBe(
      "recorded",
    );
  });

  it("records nothing when the history is off (maxVersions 0)", () => {
    const r = recordVersion([], tab("SELECT 1"), "run", 1, { maxVersions: 0, maxDays: 0 });
    expect(r.outcome).toBe("disabled");
    expect(r.list).toEqual([]);
  });

  it("keeps only the newest version with maxVersions 1", () => {
    const one = { maxVersions: 1, maxDays: 0 };
    let list = recordVersion([], tab("A"), "auto", 1, one).list;
    list = recordVersion(list, tab("B"), "auto", 2, one).list;
    expect(list[0].versions).toEqual([{ ts: 2, reason: "auto", sql: "B" }]);
  });

  it("keeps tabs apart, the last one touched first, with its latest title", () => {
    let list = recordVersion([], tab("A", 1), "auto", 1, keep).list;
    list = recordVersion(list, tab("B", 2, "Otra"), "auto", 2, keep).list;
    list = recordVersion(list, tab("A2", 1, "Renombrada"), "run", 3, keep).list;
    expect(list.map((h) => [h.tabId, h.title, h.versions.length])).toEqual([
      [1, "Renombrada", 2],
      [2, "Otra", 1],
    ]);
  });

  it("restore is undoable: what the tab held, then the restored text, are both kept", () => {
    let list = recordVersion([], tab("old"), "auto", 1, keep).list;
    list = recordVersion(list, tab("new"), "run", 2, keep).list;
    // Restoring "old" over "new": the current text first, then the restore.
    list = recordVersion(list, tab("new"), "auto", 3, keep).list;
    list = recordVersion(list, tab("old"), "restore", 3, keep).list;
    expect(list[0].versions.map((v) => `${v.reason}:${v.sql}`)).toEqual([
      "restore:old",
      "run:new",
      "auto:old",
    ]);
  });
});

describe("pruneHistory", () => {
  const h = (tabId: number, ...versions: [number, string][]): TabHistory => ({
    tabId,
    title: `T${tabId}`,
    versions: versions.map(([ts, sql]) => ({ ts, reason: "auto", sql })),
  });

  it("drops versions older than maxDays and tabs left empty", () => {
    const now = 100 * DAY;
    const list = [h(1, [now - DAY, "new"], [now - 10 * DAY, "old"]), h(2, [now - 30 * DAY, "gone"])];
    expect(pruneHistory(list, { maxVersions: 50, maxDays: 7 }, now)).toEqual([h(1, [now - DAY, "new"])]);
  });

  it("maxDays 0 means no age limit", () => {
    const list = [h(1, [0, "ancient"])];
    expect(pruneHistory(list, { maxVersions: 50, maxDays: 0 }, 1000 * DAY)).toEqual(list);
  });

  it("keeps the newest maxVersions of each tab", () => {
    const list = [h(1, [3, "c"], [2, "b"], [1, "a"]), h(2, [5, "z"])];
    expect(pruneHistory(list, { maxVersions: 2, maxDays: 0 }, 10)).toEqual([
      h(1, [3, "c"], [2, "b"]),
      h(2, [5, "z"]),
    ]);
  });

  it("maxVersions 0 clears everything", () => {
    expect(pruneHistory([h(1, [1, "a"])], { maxVersions: 0, maxDays: 0 }, 2)).toEqual([]);
  });

  it("drops the oldest versions across tabs until the total fits", () => {
    const list = [h(1, [4, "dddd"], [1, "aaaa"]), h(2, [3, "cccc"], [2, "bbbb"])];
    // 16 chars stored, 8 allowed: the two oldest (ts 1 and 2) go.
    expect(pruneHistory(list, keep, 10, 8)).toEqual([h(1, [4, "dddd"]), h(2, [3, "cccc"])]);
  });

  it("is a no-op on an empty history", () => {
    expect(pruneHistory([], keep, 1)).toEqual([]);
  });
});

describe("serialize / parse", () => {
  it("round-trips", () => {
    const list = recordVersion([], tab("SELECT 1"), "close", 5, keep).list;
    expect(parseLocalHistory(serializeLocalHistory(list))).toEqual(list);
  });

  it("returns [] for nothing, garbage and non-arrays", () => {
    expect(parseLocalHistory(null)).toEqual([]);
    expect(parseLocalHistory("{oops")).toEqual([]);
    expect(parseLocalHistory('{"tabId":1}')).toEqual([]);
  });

  it("drops malformed tabs, versions with an unknown reason, and duplicate tab ids", () => {
    const raw = JSON.stringify([
      { tabId: 1, title: "ok", versions: [{ ts: 1, reason: "run", sql: "a" }, { ts: 2, reason: "bogus", sql: "b" }] },
      { tabId: 1, title: "dup", versions: [{ ts: 3, reason: "run", sql: "c" }] },
      { tabId: "2", title: "bad id", versions: [] },
      { tabId: 3, title: "no versions", versions: [{ ts: "x", reason: "run", sql: "d" }] },
    ]);
    expect(parseLocalHistory(raw)).toEqual([
      { tabId: 1, title: "ok", versions: [{ ts: 1, reason: "run", sql: "a" }] },
    ]);
  });
});
