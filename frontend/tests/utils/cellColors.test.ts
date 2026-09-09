import { describe, it, expect } from "vitest";
import {
  CELL_VAR,
  CELL_KINDS,
  applyCellColors,
  colorsFor,
  isReadable,
  normalizeHex,
  paletteKey,
  parseCellColors,
  serializeCellColors,
  withColors,
  type CellColorStore,
} from "../../src/utils/cellColors";

describe("paletteKey", () => {
  it("gives a theme that owns its surfaces its own key", () => {
    expect(paletteKey("dark", "terminal")).toBe("terminal");
    expect(paletteKey("dark", "ciruela")).toBe("ciruela");
  });

  it("keys an accent skin by the theme it layers over", () => {
    expect(paletteKey("light", "indigo")).toBe("light");
    expect(paletteKey("dark", "indigo")).toBe("dark");
    expect(paletteKey("light", "blue")).toBe("light");
  });
});

describe("normalizeHex", () => {
  it("expands the short form and lowercases", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("  #6BA1C7 ")).toBe("#6ba1c7");
  });

  it("refuses anything that is not a hex colour", () => {
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("rgb(1,2,3)")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("colorsFor", () => {
  it("keeps the colours of that look and nothing else", () => {
    const store = {
      dark: { text: "#112233", number: "not a colour", nope: "#445566" },
      light: { text: "#ffffff" },
    } as unknown as CellColorStore;
    expect(colorsFor(store, "dark")).toEqual({ text: "#112233" });
    expect(colorsFor(store, "terminal")).toEqual({});
  });
});

describe("withColors", () => {
  it("replaces one look's set, leaving the others alone", () => {
    const store: CellColorStore = { dark: { text: "#112233" }, light: { bool: "#445566" } };
    expect(withColors(store, "dark", { text: "#000000" })).toEqual({
      dark: { text: "#000000" },
      light: { bool: "#445566" },
    });
  });

  it("drops the look entirely when nothing is overridden any more", () => {
    const store: CellColorStore = { dark: { text: "#112233" }, light: { bool: "#445566" } };
    expect(withColors(store, "dark", {})).toEqual({ light: { bool: "#445566" } });
  });
});

describe("parseCellColors", () => {
  it("round-trips what was saved", () => {
    const store: CellColorStore = { terminal: { text: "#529875", null: "#e0a13c" } };
    expect(parseCellColors(serializeCellColors(store))).toEqual(store);
  });

  it("never throws on rubbish, and keeps nothing from it", () => {
    expect(parseCellColors(null)).toEqual({});
    expect(parseCellColors("{")).toEqual({});
    expect(parseCellColors("[1,2]")).toEqual({});
    expect(parseCellColors(JSON.stringify({ dark: { text: 7 } }))).toEqual({});
  });
});

describe("applyCellColors", () => {
  /** Records what a style declaration would have been told to do. */
  const target = () => {
    const set: Record<string, string> = {};
    const removed: string[] = [];
    return {
      set,
      removed,
      setProperty: (name: string, value: string) => {
        set[name] = value;
      },
      removeProperty: (name: string) => {
        removed.push(name);
      },
    };
  };

  it("writes the overrides as custom properties", () => {
    const t = target();
    applyCellColors(t, { text: "#112233", number: "#445566" });
    expect(t.set[CELL_VAR.text]).toBe("#112233");
    expect(t.set[CELL_VAR.number]).toBe("#445566");
  });

  it("removes the ones no longer overridden, so a theme gets its own back", () => {
    const t = target();
    applyCellColors(t, { text: "#112233" });
    expect(t.removed).toEqual(
      CELL_KINDS.filter((k) => k !== "text").map((k) => CELL_VAR[k]),
    );
  });

  it("clears everything for a look with no overrides at all", () => {
    const t = target();
    applyCellColors(t, {});
    expect(Object.keys(t.set)).toEqual([]);
    expect(t.removed.sort()).toEqual(CELL_KINDS.map((k) => CELL_VAR[k]).sort());
  });
});

describe("isReadable", () => {
  it("passes a colour that clears AA on the background", () => {
    expect(isReadable("#6ba1c7", "#1e1e24")).toBe(true);
  });

  it("flags one that does not", () => {
    expect(isReadable("#2e2e38", "#1e1e24")).toBe(false);
  });

  it("says nothing about a value it cannot read", () => {
    expect(isReadable("var(--text)", "#1e1e24")).toBe(true);
  });
});
