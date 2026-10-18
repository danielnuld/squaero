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

  // Issue #665: the abbreviation is an optional field, so a store written by an
  // older version loads unchanged and a new one keeps it.
  it("loads an older store without abbreviations and round-trips one with them", async () => {
    localStorage.setItem(KEY, JSON.stringify([snip]));
    const mod = await freshModule();
    expect(mod.loadSnippets()).toEqual([snip]);
    mod.saveSnippets([{ ...snip, abbr: "ord" }]);
    expect(mod.loadSnippets()).toEqual([{ ...snip, abbr: "ord" }]);
  });

  it("does not throw when saving to a full/blocked store", async () => {
    const mod = await freshModule();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => mod.saveSnippets([snip])).not.toThrow();
  });
});
