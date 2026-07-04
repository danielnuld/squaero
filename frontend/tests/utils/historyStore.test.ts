import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { HistoryEntry } from "../../src/utils/history";
import { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, MIN_HISTORY_LIMIT } from "../../src/utils/history";

const KEY = "quaero.history";
const LIMIT_KEY = "quaero.history.limit";

const entry: HistoryEntry = { sql: "SELECT 1", ts: 10, connId: "c1", connName: "Demo" };

// historyStore captures its backing store at import time, so each test resets the
// module registry and imports fresh after arranging globals.
async function freshModule() {
  return import("../../src/utils/historyStore");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks(); // spyOn(Storage.prototype) must not leak into later tests
});

describe("historyStore (log)", () => {
  it("round-trips the history through localStorage", async () => {
    const mod = await freshModule();
    mod.saveHistory([entry]);
    expect(mod.loadHistory()).toEqual([entry]);
    expect(localStorage.getItem(KEY)).toContain("SELECT 1");
  });

  it("returns [] when nothing is stored or data is corrupt", async () => {
    let mod = await freshModule();
    expect(mod.loadHistory()).toEqual([]);
    localStorage.setItem(KEY, "not json");
    vi.resetModules();
    mod = await freshModule();
    expect(mod.loadHistory()).toEqual([]);
  });

  it("does not throw when saving to a full/blocked store", async () => {
    const mod = await freshModule();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => mod.saveHistory([entry])).not.toThrow();
  });
});

describe("historyStore (limit)", () => {
  it("defaults when the limit key is unset", async () => {
    const mod = await freshModule();
    expect(mod.loadHistoryLimit()).toBe(DEFAULT_HISTORY_LIMIT);
  });

  it("clamps an out-of-range persisted limit on load", async () => {
    localStorage.setItem(LIMIT_KEY, "1"); // below MIN
    let mod = await freshModule();
    expect(mod.loadHistoryLimit()).toBe(MIN_HISTORY_LIMIT);
    localStorage.setItem(LIMIT_KEY, "999999"); // above MAX
    vi.resetModules();
    mod = await freshModule();
    expect(mod.loadHistoryLimit()).toBe(MAX_HISTORY_LIMIT);
  });

  it("falls back to the default for a garbage limit", async () => {
    localStorage.setItem(LIMIT_KEY, "abc");
    const mod = await freshModule();
    expect(mod.loadHistoryLimit()).toBe(DEFAULT_HISTORY_LIMIT);
  });

  it("persists a clamped limit", async () => {
    const mod = await freshModule();
    mod.saveHistoryLimit(5); // below MIN -> clamped
    expect(localStorage.getItem(LIMIT_KEY)).toBe(String(MIN_HISTORY_LIMIT));
    expect(mod.loadHistoryLimit()).toBe(MIN_HISTORY_LIMIT);
  });
});
