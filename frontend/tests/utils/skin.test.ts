import { describe, it, expect } from "vitest";
import { loadSkin, saveSkin, applySkin, skinLabel, SKIN_KEY } from "../../src/utils/skin";

function memStore(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    _m: m,
  };
}

describe("skin (accent selection)", () => {
  it("defaults to the indigo brand", () => {
    expect(loadSkin(memStore())).toBe("indigo");
    expect(loadSkin(memStore({ [SKIN_KEY]: "bogus" }))).toBe("indigo");
    expect(loadSkin(undefined)).toBe("indigo");
  });

  it("loads a persisted blue skin", () => {
    expect(loadSkin(memStore({ [SKIN_KEY]: "blue" }))).toBe("blue");
  });

  it("round-trips via save/load", () => {
    const s = memStore();
    saveSkin("blue", s);
    expect(s._m.get(SKIN_KEY)).toBe("blue");
    expect(loadSkin(s)).toBe("blue");
  });

  it("stamps data-skin on the root (always, even for the default)", () => {
    let attr: [string, string] | null = null;
    const root = { setAttribute: (k: string, v: string) => (attr = [k, v]) };
    applySkin("blue", root);
    expect(attr).toEqual(["data-skin", "blue"]);
    applySkin("indigo", root);
    expect(attr).toEqual(["data-skin", "indigo"]);
  });

  it("labels both skins", () => {
    expect(skinLabel("blue")).toMatch(/Azul/);
    expect(skinLabel("indigo")).toMatch(/índigo|Quaero/);
  });
});
