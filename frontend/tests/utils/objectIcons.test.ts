import { describe, it, expect } from "vitest";
import { objectBadge, routineKind, type ObjectKind } from "../../src/utils/objectIcons";

describe("objectBadge", () => {
  it("maps every canonical kind to a text code and a kind-* class", () => {
    const kinds: ObjectKind[] = [
      "database",
      "schema",
      "table",
      "view",
      "procedure",
      "function",
      "routine",
      "trigger",
      "event",
    ];
    for (const k of kinds) {
      const b = objectBadge(k);
      expect(b.text).toMatch(/^[A-Z]+$/);
      expect(b.className).toMatch(/^kind-/);
    }
  });

  it("uses distinct, stable text codes per type", () => {
    expect(objectBadge("database").text).toBe("DB");
    expect(objectBadge("schema").text).toBe("SCH");
    expect(objectBadge("table").text).toBe("TBL");
    expect(objectBadge("view").text).toBe("VW");
    expect(objectBadge("procedure").text).toBe("PROC");
    expect(objectBadge("function").text).toBe("FN");
    expect(objectBadge("trigger").text).toBe("TRG");
    expect(objectBadge("event").text).toBe("EVT");
  });

  it("shares the routine colour class across proc/function/routine", () => {
    expect(objectBadge("procedure").className).toBe("kind-routine");
    expect(objectBadge("function").className).toBe("kind-routine");
    expect(objectBadge("routine").className).toBe("kind-routine");
  });

  it("falls back to a neutral chip for an unknown kind", () => {
    const b = objectBadge("nonsense");
    expect(b.text).toBe("?");
    expect(b.className).toBe("kind-unknown");
  });
});

describe("routineKind", () => {
  it("classifies FUNCTION types as function", () => {
    expect(routineKind("FUNCTION")).toBe("function");
    expect(routineKind("function")).toBe("function");
    expect(routineKind("SQL FUNCTION")).toBe("function");
  });

  it("treats everything else (incl. null/empty) as procedure", () => {
    expect(routineKind("PROCEDURE")).toBe("procedure");
    expect(routineKind("procedure")).toBe("procedure");
    expect(routineKind("")).toBe("procedure");
    expect(routineKind(null)).toBe("procedure");
    expect(routineKind(undefined)).toBe("procedure");
  });
});
