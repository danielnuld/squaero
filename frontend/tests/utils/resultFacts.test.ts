import { describe, it, expect } from "vitest";
import { sourceLabel } from "../../src/utils/resultFacts";

// Issue #386: the status bar names the object the rows came from, which is the
// one fact the information pane carried that the bar did not already have.
describe("sourceLabel", () => {
  it("qualifies with every part the engine has", () => {
    expect(sourceLabel({ table: "clientes", db: "ventas", schema: "public", pk: [] })).toBe(
      "ventas.public.clientes",
    );
    expect(sourceLabel({ table: "clientes", db: "ventas", pk: [] })).toBe("ventas.clientes");
    expect(sourceLabel({ table: "clientes", pk: [] })).toBe("clientes");
  });

  it("says nothing when the rows came from a hand-written query", () => {
    expect(sourceLabel(null)).toBeNull();
    expect(sourceLabel(undefined)).toBeNull();
  });

  it("skips empty parts rather than emitting a leading dot", () => {
    expect(sourceLabel({ table: "clientes", db: "", schema: "", pk: [] })).toBe("clientes");
  });
});
