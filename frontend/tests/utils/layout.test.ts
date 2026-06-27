import { describe, it, expect } from "vitest";
import {
  clampSidebarWidth,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
} from "../../src/utils/layout";

describe("clampSidebarWidth", () => {
  it("passes through a width inside the band", () => {
    expect(clampSidebarWidth(300)).toBe(300);
  });

  it("clamps below the minimum", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN);
  });

  it("clamps above the maximum", () => {
    expect(clampSidebarWidth(10000)).toBe(SIDEBAR_MAX);
  });

  it("falls back to the minimum for NaN", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_MIN);
  });

  it("honors custom bounds", () => {
    expect(clampSidebarWidth(50, 100, 200)).toBe(100);
    expect(clampSidebarWidth(250, 100, 200)).toBe(200);
  });
});
