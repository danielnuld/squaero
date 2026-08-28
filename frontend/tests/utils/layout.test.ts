import { describe, it, expect } from "vitest";
import {
  clampEditorPct,
  clampSidebarWidth,
  EDITOR_PCT_DEFAULT,
  EDITOR_PCT_MAX,
  EDITOR_PCT_MIN,
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

describe("clampEditorPct", () => {
  it("keeps a share inside the band", () => {
    expect(clampEditorPct(65)).toBe(65);
  });

  it("never lets the editor vanish", () => {
    expect(clampEditorPct(2)).toBe(EDITOR_PCT_MIN);
    expect(clampEditorPct(-40)).toBe(EDITOR_PCT_MIN);
  });

  it("lets the editor take the whole pane, hiding the result", () => {
    expect(clampEditorPct(140)).toBe(EDITOR_PCT_MAX);
    expect(EDITOR_PCT_MAX).toBe(100);
  });

  it("falls back to the default for NaN", () => {
    expect(clampEditorPct(Number.NaN)).toBe(EDITOR_PCT_DEFAULT);
  });
});
