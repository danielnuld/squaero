import { describe, it, expect } from "vitest";
import { isContextMenuKey, stepIndex, typeAhead } from "../../src/utils/listNav";

describe("stepIndex", () => {
  it("moves down and up, wrapping at both ends", () => {
    expect(stepIndex(3, 0, "ArrowDown")).toBe(1);
    expect(stepIndex(3, 2, "ArrowDown")).toBe(0);
    expect(stepIndex(3, 0, "ArrowUp")).toBe(2);
  });

  it("lands on the first or last item when nothing is active yet", () => {
    expect(stepIndex(3, -1, "ArrowDown")).toBe(0);
    expect(stepIndex(3, -1, "ArrowUp")).toBe(2);
  });

  it("jumps to the ends with Home and End", () => {
    expect(stepIndex(5, 2, "Home")).toBe(0);
    expect(stepIndex(5, 2, "End")).toBe(4);
  });

  it("pages ten rows and stops at the ends", () => {
    expect(stepIndex(30, 5, "PageDown")).toBe(15);
    expect(stepIndex(30, 25, "PageDown")).toBe(29);
    expect(stepIndex(30, 3, "PageUp")).toBe(0);
  });

  it("skips disabled items in every direction", () => {
    const dis = (i: number) => i === 1 || i === 4;
    expect(stepIndex(5, 0, "ArrowDown", dis)).toBe(2);
    expect(stepIndex(5, 0, "ArrowUp", dis)).toBe(3);
    expect(stepIndex(5, 2, "End", dis)).toBe(3);
    expect(stepIndex(5, -1, "ArrowDown", (i) => i === 0)).toBe(1);
  });

  it("stays put on an unknown key and reports -1 for an empty or all-disabled list", () => {
    expect(stepIndex(3, 1, "x")).toBe(1);
    expect(stepIndex(0, -1, "ArrowDown")).toBe(-1);
    expect(stepIndex(2, -1, "ArrowDown", () => true)).toBe(-1);
  });
});

describe("typeAhead", () => {
  const labels = ["apple", "Avocado", "banana", "blueberry", "cherry"];

  it("finds the next label starting with a letter, case-insensitively", () => {
    expect(typeAhead(labels, -1, "a")).toBe(0);
    expect(typeAhead(labels, 0, "a")).toBe(1);
    expect(typeAhead(labels, 1, "B")).toBe(2);
  });

  it("cycles when the same letter is repeated", () => {
    expect(typeAhead(labels, 0, "aa")).toBe(1);
    expect(typeAhead(labels, 1, "aaa")).toBe(0);
  });

  it("refines on a longer prefix from the current item", () => {
    expect(typeAhead(labels, 2, "bl")).toBe(3);
    expect(typeAhead(labels, 0, "ap")).toBe(0);
  });

  it("skips disabled items and reports -1 when nothing matches", () => {
    expect(typeAhead(labels, -1, "b", (i) => i === 2)).toBe(3);
    expect(typeAhead(labels, -1, "z")).toBe(-1);
    expect(typeAhead(labels, -1, "")).toBe(-1);
    expect(typeAhead([], -1, "a")).toBe(-1);
  });
});

describe("isContextMenuKey", () => {
  it("recognises the Menu key and Shift+F10 only", () => {
    expect(isContextMenuKey({ key: "ContextMenu", shiftKey: false })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: false })).toBe(false);
    expect(isContextMenuKey({ key: "Enter", shiftKey: true })).toBe(false);
  });
});
