import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Snippet } from "../../src/utils/snippets";

const KEY = "quaero.snippets";
const snip: Snippet = { id: "snip-1", name: "Orders", body: "SELECT * FROM orders" };

async function freshModule() {
  return import("../../src/utils/snippetStore");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("snippetStore", () => {
  it("round-trips snippets through localStorage", async () => {
    const mod = await freshModule();
    mod.saveSnippets([snip]);
    expect(mod.loadSnippets()).toEqual([snip]);
    expect(localStorage.getItem(KEY)).toContain("Orders");
  });

  it("returns [] when nothing is stored or data is corrupt", async () => {
    let mod = await freshModule();
    expect(mod.loadSnippets()).toEqual([]);
    localStorage.setItem(KEY, "not json");
    vi.resetModules();
    mod = await freshModule();
    expect(mod.loadSnippets()).toEqual([]);
  });

  it("does not throw when saving to a full/blocked store", async () => {
    const mod = await freshModule();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => mod.saveSnippets([snip])).not.toThrow();
  });
});
