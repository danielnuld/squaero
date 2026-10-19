import { describe, it, expect } from "vitest";
import {
  pagerView,
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  parsePageSize,
  offsetForPageSize,
  type PagerInput,
} from "../../src/utils/pager";

const base: PagerInput = { offset: 0, rows: 1000, size: 1000, total: null, more: true, paused: false };

describe("pagerView", () => {
  it("shows the first page of an uncounted table", () => {
    expect(pagerView(base)).toEqual({
      from: 1,
      to: 1000,
      page: 1,
      pages: null,
      canFirst: false,
      canPrev: false,
      canNext: true,
      canLast: false,
      lastOffset: null,
    });
  });

  it("reaches the last page once the total is counted", () => {
    const v = pagerView({ ...base, offset: 1000, total: 3500 });
    expect(v).toMatchObject({ from: 1001, to: 2000, page: 2, pages: 4, canFirst: true, canLast: true, lastOffset: 3000 });
  });

  it("trusts the total over a full last page", () => {
    const v = pagerView({ ...base, offset: 1000, total: 2000, more: true });
    expect(v.canNext).toBe(false);
    expect(v.canLast).toBe(false);
  });

  it("holds every jump while edits are unsaved", () => {
    const v = pagerView({ ...base, offset: 1000, total: 5000, paused: true });
    expect([v.canFirst, v.canPrev, v.canNext, v.canLast]).toEqual([false, false, false, false]);
  });

  it("handles an empty table and a nonsense page size", () => {
    expect(pagerView({ ...base, rows: 0, more: false, total: 0, size: 0 })).toMatchObject({
      from: 0,
      to: 0,
      page: 1,
      pages: 1,
      canNext: false,
      canLast: false,
    });
  });
});

describe("page size (A-20, R-38)", () => {
  it("offers the four sizes, 1000 by default", () => {
    expect([...PAGE_SIZES]).toEqual([100, 500, 1000, 5000]);
    expect(DEFAULT_PAGE_SIZE).toBe(1000);
  });

  it("reads back a remembered size", () => {
    expect(parsePageSize("500")).toBe(500);
    expect(parsePageSize("5000")).toBe(5000);
  });

  it("falls back to the default for anything not offered", () => {
    expect(parsePageSize(null)).toBe(1000);
    expect(parsePageSize(undefined)).toBe(1000);
    expect(parsePageSize("")).toBe(1000);
    expect(parsePageSize("250")).toBe(1000);
    expect(parsePageSize("abc")).toBe(1000);
    expect(parsePageSize("-100")).toBe(1000);
  });

  it("keeps the first row on screen when the size changes", () => {
    expect(offsetForPageSize(0, 500)).toBe(0);
    expect(offsetForPageSize(1000, 500)).toBe(1000);
    expect(offsetForPageSize(1000, 5000)).toBe(0);
    expect(offsetForPageSize(2000, 1000)).toBe(2000);
    expect(offsetForPageSize(1500, 1000)).toBe(1000);
    expect(offsetForPageSize(300, 100)).toBe(300);
  });

  it("clamps a negative offset or a degenerate size", () => {
    expect(offsetForPageSize(-5, 100)).toBe(0);
    expect(offsetForPageSize(7, 0)).toBe(7);
  });
});
