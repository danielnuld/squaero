import { describe, it, expect } from "vitest";
import {
  detectLocale,
  translate,
  loadLocale,
  saveLocale,
  isLocale,
  LOCALE_KEY,
} from "../../src/utils/i18n";
import { es } from "../../src/utils/messages/es";
import { en } from "../../src/utils/messages/en";

describe("detectLocale", () => {
  it("maps English tags to en", () => {
    expect(detectLocale("en")).toBe("en");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("EN-GB")).toBe("en");
  });
  it("falls back to es for anything else", () => {
    expect(detectLocale("es-MX")).toBe("es");
    expect(detectLocale("fr")).toBe("es");
    expect(detectLocale("")).toBe("es");
    expect(detectLocale(null)).toBe("es");
    expect(detectLocale(undefined)).toBe("es");
  });
});

describe("translate", () => {
  it("returns the string for the active locale", () => {
    expect(translate("es", "status.noConnection")).toBe("Sin conexión");
    expect(translate("en", "status.noConnection")).toBe("Not connected");
  });
  it("interpolates named params", () => {
    expect(translate("en", "status.rowsOther", { n: 42 })).toBe("42 rows");
    expect(translate("es", "status.rowsOne", { n: 1 })).toBe("1 fila");
  });
  it("leaves unknown placeholders intact", () => {
    expect(translate("en", "status.rowsOther", {})).toBe("{n} rows");
  });
  it("falls back to the key itself when absent everywhere", () => {
    expect(translate("en", "totally.missing.key")).toBe("totally.missing.key");
  });
});

describe("es/en catalog parity", () => {
  it("en only defines keys that exist in the es base (so es-fallback always works)", () => {
    for (const k of Object.keys(en)) expect(es[k]).toBeDefined();
  });
});

describe("isLocale", () => {
  it("accepts supported locales only", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(3)).toBe(false);
  });
});

describe("load/save locale", () => {
  function fakeStore() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }
  it("round-trips a saved locale", () => {
    const s = fakeStore();
    saveLocale("en", s);
    expect(s.getItem(LOCALE_KEY)).toBe("en");
    expect(loadLocale(s)).toBe("en");
  });
  it("returns null when unset or invalid", () => {
    const s = fakeStore();
    expect(loadLocale(s)).toBeNull();
    s.setItem(LOCALE_KEY, "fr");
    expect(loadLocale(s)).toBeNull();
  });
  it("never throws on a hostile store", () => {
    const throwing = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(loadLocale(throwing)).toBeNull();
    expect(() => saveLocale("es", throwing)).not.toThrow();
  });
});
