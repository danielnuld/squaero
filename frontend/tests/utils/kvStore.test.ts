import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// kvStore caches the resolved store in a module singleton, so each test resets
// the module registry and imports fresh after arranging globals.
async function freshModule() {
  return import("../../src/utils/kvStore");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kvStore.resolveStore", () => {
  it("uses localStorage when it is usable", async () => {
    const mod = await freshModule();
    const store = mod.resolveStore();
    store.setItem("k", "v");
    expect(localStorage.getItem("k")).toBe("v");
    expect(store.getItem("k")).toBe("v");
  });

  it("returns the same instance across calls (cached)", async () => {
    const mod = await freshModule();
    expect(mod.resolveStore()).toBe(mod.resolveStore());
  });

  it("falls back to an in-memory store when localStorage throws on probe", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    const mod = await freshModule();
    const store = mod.resolveStore();
    // Works against the fallback without touching the throwing localStorage.
    store.setItem("k", "v");
    expect(store.getItem("k")).toBe("v");
    expect(store.getItem("missing")).toBeNull();
    store.removeItem?.("k");
    expect(store.getItem("k")).toBeNull();
  });

  it("keeps keys independent in the in-memory fallback", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    const mod = await freshModule();
    const store = mod.resolveStore();
    store.setItem("a", "1");
    store.setItem("b", "2");
    expect(store.getItem("a")).toBe("1");
    expect(store.getItem("b")).toBe("2");
  });
});
