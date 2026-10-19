import { describe, it, expect } from "vitest";
import { objectBadge, routineKind, type ObjectKind } from "../../src/utils/objectIcons";
import { ICONS } from "../../src/components/icons";

describe("objectBadge", () => {
  it("maps every canonical kind to an icon of the set and a kind-* class", () => {
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
      expect(ICONS).toHaveProperty(b.icon);
      expect(b.className).toMatch(/^kind-/);
    }
  });

  it("draws each type with its own icon (#683)", () => {
    expect(objectBadge("database").icon).toBe("database");
    expect(objectBadge("schema").icon).toBe("schema");
    expect(objectBadge("table").icon).toBe("table");
    expect(objectBadge("view").icon).toBe("view");
    expect(objectBadge("procedure").icon).toBe("procedure");
    expect(objectBadge("routine").icon).toBe("procedure");
    expect(objectBadge("function").icon).toBe("function");
    expect(objectBadge("trigger").icon).toBe("trigger");
    expect(objectBadge("event").icon).toBe("event");
  });

  it("gives functions their own colour class, procedures/routines share one", () => {
    // Distinct hues per object type (design proposal).
    expect(objectBadge("procedure").className).toBe("kind-procedure");
    expect(objectBadge("routine").className).toBe("kind-procedure");
    expect(objectBadge("function").className).toBe("kind-function");
  });

  it("falls back to a neutral mark for an unknown kind", () => {
    const b = objectBadge("nonsense");
    expect(b.icon).toBe("help");
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
