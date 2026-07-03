import { describe, it, expect } from "vitest";
import { addTab, cycleTab, type TabState } from "../../src/utils/tabs";

// Build a state with `n` tabs (ids 1..n) and a chosen active id.
const make = (n: number, activeId: number): TabState => {
  let s: TabState = { tabs: [], activeId: 0 };
  for (let i = 0; i < n; i++) s = addTab(s);
  return { ...s, activeId };
};

describe("cycleTab", () => {
  it("moves to the next tab", () => {
    expect(cycleTab(make(3, 1), 1).activeId).toBe(2);
    expect(cycleTab(make(3, 2), 1).activeId).toBe(3);
  });
  it("moves to the previous tab", () => {
    expect(cycleTab(make(3, 2), -1).activeId).toBe(1);
  });
  it("wraps around both ends", () => {
    expect(cycleTab(make(3, 3), 1).activeId).toBe(1);
    expect(cycleTab(make(3, 1), -1).activeId).toBe(3);
  });
  it("is a no-op with fewer than two tabs", () => {
    expect(cycleTab(make(1, 1), 1).activeId).toBe(1);
    expect(cycleTab({ tabs: [], activeId: 0 }, 1).activeId).toBe(0);
  });
  it("is a no-op when the active id is unknown", () => {
    expect(cycleTab(make(3, 99), 1).activeId).toBe(99);
  });
});
