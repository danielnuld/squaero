import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { TabHistory } from "../../src/utils/localHistory";

const KEY = "quaero.localHistory";
const list: TabHistory[] = [
  { tabId: 4, title: "Consulta 4", versions: [{ ts: 1, reason: "run", sql: "SELECT 1" }] },
];

// The store captures its backing store at import time.
const fresh = () => import("../../src/utils/localHistoryStore");

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("localHistoryStore", () => {
  it("round-trips through localStorage", async () => {
    const mod = await fresh();
    expect(mod.loadLocalHistory()).toEqual([]);
    expect(mod.saveLocalHistory(list)).toBe(true);
    expect(localStorage.getItem(KEY)).toContain("SELECT 1");
    expect(mod.loadLocalHistory()).toEqual(list);
  });

  it("reports a refused write instead of swallowing it", async () => {
    const mod = await fresh();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(mod.saveLocalHistory(list)).toBe(false);
  });
});
