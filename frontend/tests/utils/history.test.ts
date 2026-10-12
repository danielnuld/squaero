import { describe, it, expect } from "vitest";
import {
  addHistory,
  searchHistory,
  historyEngines,
  recentForEngine,
  oneLine,
  timeAgo,
  serializeHistory,
  parseHistory,
  clampLimit,
  DEFAULT_HISTORY_LIMIT,
  MIN_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  type HistoryEntry,
} from "../../src/utils/history";

const entry = (sql: string, ts: number, connId = "c1", connName = "Demo"): HistoryEntry => ({
  sql,
  ts,
  connId,
  connName,
});

describe("addHistory", () => {
  it("prepends the newest entry", () => {
    const list = addHistory([entry("SELECT 1", 1)], entry("SELECT 2", 2));
    expect(list.map((e) => e.sql)).toEqual(["SELECT 2", "SELECT 1"]);
  });

  it("trims the sql and ignores a blank query", () => {
    expect(addHistory([], entry("   ", 1))).toEqual([]);
    expect(addHistory([], entry("  SELECT 1  ", 1))[0].sql).toBe("SELECT 1");
  });

  it("collapses an immediate repeat of the same sql + connection", () => {
    let list = addHistory([], entry("SELECT 1", 1));
    list = addHistory(list, entry("SELECT 1", 5));
    expect(list).toHaveLength(1);
    expect(list[0].ts).toBe(5); // timestamp refreshed
  });

  it("does not collapse the same sql on a different connection", () => {
    let list = addHistory([], entry("SELECT 1", 1, "c1"));
    list = addHistory(list, entry("SELECT 1", 2, "c2"));
    expect(list).toHaveLength(2);
  });

  it("does not collapse a repeat that is not the newest", () => {
    let list = addHistory([], entry("SELECT 1", 1));
    list = addHistory(list, entry("SELECT 2", 2));
    list = addHistory(list, entry("SELECT 1", 3));
    expect(list.map((e) => e.sql)).toEqual(["SELECT 1", "SELECT 2", "SELECT 1"]);
  });

  it("purges the oldest entries past the limit", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 15; i++) list = addHistory(list, entry(`SELECT ${i}`, i), MIN_HISTORY_LIMIT);
    expect(list).toHaveLength(MIN_HISTORY_LIMIT);
    expect(list[0].sql).toBe("SELECT 14"); // newest kept
    expect(list.at(-1)!.sql).toBe("SELECT 5"); // oldest within cap
  });
});

describe("searchHistory", () => {
  const list = [entry("SELECT * FROM orders", 3), entry("UPDATE customers SET x=1", 2, "c2"), entry("select 1", 1)];

  it("matches case-insensitive substrings, newest-first", () => {
    expect(searchHistory(list, "select").map((e) => e.sql)).toEqual([
      "SELECT * FROM orders",
      "select 1",
    ]);
  });

  it("returns everything for a blank query", () => {
    expect(searchHistory(list, "  ")).toHaveLength(3);
  });

  it("filters by connection when connId is given", () => {
    expect(searchHistory(list, "", "c2").map((e) => e.sql)).toEqual(["UPDATE customers SET x=1"]);
  });
});

describe("clampLimit", () => {
  it("bounds the limit and floors fractionals", () => {
    expect(clampLimit(1)).toBe(MIN_HISTORY_LIMIT);
    expect(clampLimit(999999)).toBe(MAX_HISTORY_LIMIT);
    expect(clampLimit(50.9)).toBe(50);
    expect(clampLimit(NaN)).toBe(DEFAULT_HISTORY_LIMIT);
  });
});

describe("serializeHistory / parseHistory", () => {
  it("round-trips", () => {
    const list = [entry("SELECT 1", 1), entry("SELECT 2", 2, "c2", "PG")];
    expect(parseHistory(serializeHistory(list))).toEqual(list);
  });

  it("returns [] for null/garbage/non-array", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("not json")).toEqual([]);
    expect(parseHistory("{}")).toEqual([]);
  });

  it("drops malformed entries", () => {
    const raw = JSON.stringify([
      { sql: "SELECT 1", ts: 1, connId: "c1", connName: "Demo" },
      { sql: "bad", ts: "nope", connId: "c1", connName: "Demo" },
      { sql: 5, ts: 1, connId: "c1", connName: "Demo" },
    ]);
    expect(parseHistory(raw)).toEqual([entry("SELECT 1", 1)]);
  });

  it("round-trips the optional durationMs and ignores an invalid one (#179)", () => {
    const withDur = { sql: "SELECT 1", ts: 1, connId: "c1", connName: "Demo", durationMs: 1234 };
    expect(parseHistory(serializeHistory([withDur]))).toEqual([withDur]);
    // A non-finite/absent duration simply isn't carried (entry stays valid).
    const badDur = JSON.stringify([{ sql: "SELECT 2", ts: 2, connId: "c1", connName: "Demo", durationMs: "slow" }]);
    expect(parseHistory(badDur)).toEqual([entry("SELECT 2", 2)]);
  });
});

// Issue #642: queries kept per engine, so MySQL, Informix and Mongo don't mix.
describe("history per engine", () => {
  const on = (sql: string, ts: number, engine?: string): HistoryEntry => ({
    ...entry(sql, ts),
    ...(engine ? { engine } : {}),
  });
  const list = [
    on("SELECT 1", 50, "mysql"),
    on("db.c.find({})", 40, "mongodb"),
    on("SELECT 1", 30, "mysql"),
    on("SELECT FIRST 1 *", 20, "informix"),
    on("SELECT 2", 10, "mysql"),
    on("SELECT legacy", 5),
  ];

  it("filters the search by engine, leaving legacy entries to 'all'", () => {
    expect(searchHistory(list, "", undefined, "informix").map((e) => e.sql)).toEqual(["SELECT FIRST 1 *"]);
    expect(searchHistory(list, "select", undefined, "mysql")).toHaveLength(3);
    expect(searchHistory(list, "")).toHaveLength(6);
  });

  it("lists the distinct engines present, sorted", () => {
    expect(historyEngines(list)).toEqual(["informix", "mongodb", "mysql"]);
    expect(historyEngines([])).toEqual([]);
  });

  it("recalls the latest distinct queries of one engine only", () => {
    expect(recentForEngine(list, "mysql").map((e) => e.sql)).toEqual(["SELECT 1", "SELECT 2"]);
    expect(recentForEngine(list, "mysql")[0].ts).toBe(50);
    expect(recentForEngine(list, "mysql", 1)).toHaveLength(1);
    expect(recentForEngine(list, "postgres")).toEqual([]);
  });

  it("round-trips the engine and still parses entries without one", () => {
    const back = parseHistory(serializeHistory(list));
    expect(back[0].engine).toBe("mysql");
    expect(back[5].engine).toBeUndefined();
    expect(parseHistory(JSON.stringify([{ ...entry("x", 1), engine: 7 }]))[0].engine).toBeUndefined();
  });
});

describe("oneLine", () => {
  it("collapses whitespace and cuts long text with an ellipsis", () => {
    expect(oneLine("SELECT *\n  FROM t\tWHERE a = 1")).toBe("SELECT * FROM t WHERE a = 1");
    expect(oneLine("abcdefghij", 5)).toBe("abcd…");
    expect(oneLine("abcde", 5)).toBe("abcde");
  });
});

describe("timeAgo", () => {
  const now = 1_000_000_000_000;
  it("says it in the largest unit that fits", () => {
    expect(timeAgo(now - 3 * 3_600_000, now, "en")).toBe("3 hours ago");
    expect(timeAgo(now - 5 * 60_000, now, "en")).toBe("5 minutes ago");
    expect(timeAgo(now - 2 * 86_400_000, now, "es")).toBe("anteayer");
    expect(timeAgo(now, now, "en")).toBe("now");
  });
});
