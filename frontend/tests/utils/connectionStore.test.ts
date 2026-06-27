import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Connection } from "../../src/utils/connections";

const KEY = "quaero.connections";

const sqlite: Connection = {
  id: "conn-1",
  name: "Local",
  driver: "sqlite",
  params: { path: "/tmp/app.db" },
};

const pg: Connection = {
  id: "conn-2",
  name: "PG",
  driver: "postgres",
  params: { host: "h", database: "d", user: "u", password: "secret" },
};

// connectionStore captures its backing store at import time, so each test
// resets the module registry and imports fresh after arranging globals.
async function freshModule() {
  return import("../../src/utils/connectionStore");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connectionStore (localStorage)", () => {
  it("round-trips connections through localStorage", async () => {
    const mod = await freshModule();
    mod.saveConnections([sqlite]);
    expect(mod.loadConnections()).toEqual([sqlite]);
    expect(localStorage.getItem(KEY)).toContain("conn-1");
  });

  it("strips secrets before persisting", async () => {
    const mod = await freshModule();
    mod.saveConnections([pg]);
    expect(localStorage.getItem(KEY)).not.toContain("secret");
    expect(mod.loadConnections()[0].params).toEqual({ host: "h", database: "d", user: "u" });
  });

  it("returns [] when stored data is corrupt", async () => {
    localStorage.setItem(KEY, "not json");
    const mod = await freshModule();
    expect(mod.loadConnections()).toEqual([]);
  });

  it("returns [] when nothing is stored", async () => {
    const mod = await freshModule();
    expect(mod.loadConnections()).toEqual([]);
  });
});

describe("connectionStore (fallback)", () => {
  it("falls back to an in-memory store when localStorage throws", async () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("localStorage", throwing);

    const mod = await freshModule();
    // Save/load succeed against the in-memory fallback without touching the
    // throwing localStorage.
    mod.saveConnections([sqlite]);
    expect(mod.loadConnections()).toEqual([sqlite]);
  });

  it("does not throw when saving to a full/blocked store", async () => {
    const mod = await freshModule();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => mod.saveConnections([sqlite])).not.toThrow();
  });
});
