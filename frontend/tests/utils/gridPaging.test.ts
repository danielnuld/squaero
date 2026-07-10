import { describe, it, expect } from "vitest";
import { nextOffset, pageHasMore } from "../../src/utils/gridPaging";

describe("nextOffset", () => {
  it("steps forward and back by the page size", () => {
    expect(nextOffset(0, 1, 1000)).toBe(1000);
    expect(nextOffset(1000, 1, 1000)).toBe(2000);
    expect(nextOffset(2000, -1, 1000)).toBe(1000);
  });

  it("clamps to zero (never a negative offset)", () => {
    expect(nextOffset(0, -1, 1000)).toBe(0);
    expect(nextOffset(500, -1, 1000)).toBe(0);
  });

  it("floors fractional inputs and treats size < 1 as 1", () => {
    expect(nextOffset(10.9, 1, 100.5)).toBe(110);
    expect(nextOffset(0, 1, 0)).toBe(1);
  });
});

describe("pageHasMore", () => {
  it("is true only when a full page came back", () => {
    expect(pageHasMore(1000, 1000)).toBe(true);
    expect(pageHasMore(1001, 1000)).toBe(true);
    expect(pageHasMore(999, 1000)).toBe(false);
    expect(pageHasMore(0, 1000)).toBe(false);
  });
});
