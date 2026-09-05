import { describe, it, expect } from "vitest";
import {
  loadSkin,
  saveSkin,
  applySkin,
  skinLabel,
  isDarkOnly,
  SKINS,
  SKIN_KEY,
} from "../../src/utils/skin";

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
    expect(skinLabel("indigo")).toMatch(/índigo|Squaero/);
  });
});

// Issue #473: three themes that bring their own surfaces, and therefore have no
// light variant.
describe("skin (colour themes)", () => {
  it("loads and round-trips each of the new themes", () => {
    for (const v of ["ciruela", "pizarra", "terminal"] as const) {
      expect(loadSkin(memStore({ [SKIN_KEY]: v }))).toBe(v);
      const s = memStore();
      saveSkin(v, s);
      expect(loadSkin(s)).toBe(v);
    }
  });

  it("knows which ones own their surfaces", () => {
    expect(isDarkOnly("indigo")).toBe(false);
    expect(isDarkOnly("blue")).toBe(false);
    expect(isDarkOnly("ciruela")).toBe(true);
    expect(isDarkOnly("pizarra")).toBe(true);
    expect(isDarkOnly("terminal")).toBe(true);
  });

  it("lists every skin with a label, the brand first", () => {
    expect(SKINS.map((s) => s.value)).toEqual([
      "indigo",
      "blue",
      "ciruela",
      "pizarra",
      "terminal",
    ]);
    for (const s of SKINS) {
      expect(s.label.trim()).not.toBe("");
      expect(skinLabel(s.value)).toContain(s.label);
    }
  });

  it("falls back to the brand for a value that is no longer a skin", () => {
    expect(loadSkin(memStore({ [SKIN_KEY]: "verde" }))).toBe("indigo");
    expect(skinLabel("verde" as never)).toMatch(/índigo|Squaero/);
  });
});
