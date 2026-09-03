import { describe, it, expect } from "vitest";
import {
  toggleSection,
  connObjects,
  setConnObjects,
  dropConnObjects,
} from "../../src/utils/sidebarSections";

describe("toggleSection", () => {
  it("collapses a section that was expanded, and back", () => {
    const collapsed = toggleSection(new Set(), "c1");
    expect([...collapsed]).toEqual(["c1"]);
    expect([...toggleSection(collapsed, "c1")]).toEqual([]);
  });

  it("leaves the other sections alone and does not mutate the input", () => {
    const before = new Set(["c1"]);
    const after = toggleSection(before, "c2");
    expect([...before]).toEqual(["c1"]);
    expect([...after].sort()).toEqual(["c1", "c2"]);
  });
});

describe("connObjects", () => {
  it("reads one connection's objects", () => {
    expect(connObjects({ c1: ["a"], c2: ["b"] }, "c1")).toEqual(["a"]);
  });

  it("is empty for an unknown connection or none focused", () => {
    expect(connObjects({ c1: ["a"] }, "c9")).toEqual([]);
    expect(connObjects({ c1: ["a"] }, null)).toEqual([]);
  });
});

describe("setConnObjects", () => {
  it("keeps every other connection's objects — the bug this exists for", () => {
    const map = setConnObjects({ prod: ["clientes"] }, "dev", ["facturas"]);
    expect(map).toEqual({ prod: ["clientes"], dev: ["facturas"] });
  });

  it("replaces the objects of the connection it names", () => {
    expect(setConnObjects({ prod: ["a"] }, "prod", ["b"])).toEqual({ prod: ["b"] });
  });
});

describe("dropConnObjects", () => {
  it("forgets a closed connection", () => {
    expect(dropConnObjects({ prod: ["a"], dev: ["b"] }, "dev")).toEqual({ prod: ["a"] });
  });

  it("returns the same map when there is nothing to drop", () => {
    const map = { prod: ["a"] };
    expect(dropConnObjects(map, "dev")).toBe(map);
  });
});
