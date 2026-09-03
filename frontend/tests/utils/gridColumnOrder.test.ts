import { describe, it, expect } from "vitest";
import {
  defaultOrder,
  moveColumn,
  displayIndex,
  applyOrder,
} from "../../src/utils/gridColumnOrder";

describe("defaultOrder", () => {
  it("is the engine's own order", () => {
    expect(defaultOrder(3)).toEqual([0, 1, 2]);
    expect(defaultOrder(0)).toEqual([]);
  });
});

describe("moveColumn", () => {
  it("drags a column to the right", () => {
    expect(moveColumn([0, 1, 2, 3], 0, 2)).toEqual([1, 2, 0, 3]);
  });

  it("drags a column to the left", () => {
    expect(moveColumn([0, 1, 2, 3], 3, 1)).toEqual([0, 3, 1, 2]);
  });

  it("moves what is at the display position, not the column named by it", () => {
    // Already reordered once: display position 0 holds the original column 2.
    expect(moveColumn([2, 0, 1], 0, 2)).toEqual([0, 1, 2]);
  });

  it("is a no-op for the same position or one out of range", () => {
    expect(moveColumn([0, 1, 2], 1, 1)).toEqual([0, 1, 2]);
    expect(moveColumn([0, 1, 2], -1, 1)).toEqual([0, 1, 2]);
    expect(moveColumn([0, 1, 2], 0, 9)).toEqual([0, 1, 2]);
  });

  it("does not mutate the order it was given", () => {
    const order = [0, 1, 2];
    moveColumn(order, 0, 2);
    expect(order).toEqual([0, 1, 2]);
  });
});

describe("displayIndex", () => {
  it("finds where an original column now sits", () => {
    expect(displayIndex([2, 0, 1], 2)).toBe(0);
    expect(displayIndex([2, 0, 1], 1)).toBe(2);
  });

  it("is -1 for a column the order does not carry", () => {
    expect(displayIndex([2, 0, 1], 7)).toBe(-1);
  });
});

describe("applyOrder", () => {
  it("reorders a row the way the header is drawn", () => {
    expect(applyOrder([2, 0, 1], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  });

  it("keeps NULLs in place rather than dropping them", () => {
    expect(applyOrder([1, 0], [null, "x"])).toEqual(["x", null]);
  });

  it("ignores an order that does not cover the array", () => {
    // A stale order must not silently drop or duplicate what is being copied.
    expect(applyOrder([1, 0], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(applyOrder([], ["a"])).toEqual(["a"]);
  });
});
