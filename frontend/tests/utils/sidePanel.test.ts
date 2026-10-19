import { describe, it, expect } from "vitest";
import {
  DEFAULT_SIDE,
  loadSideState,
  parseSideState,
  railClick,
  saveSideState,
} from "../../src/utils/sidePanel";

describe("parseSideState", () => {
  it("reads a stored state", () => {
    expect(parseSideState('{"panel":"history","collapsed":true}')).toEqual({
      panel: "history",
      collapsed: true,
    });
  });

  it("falls back on nothing stored, junk and unknown panels", () => {
    expect(parseSideState(null)).toEqual(DEFAULT_SIDE);
    expect(parseSideState("not json")).toEqual(DEFAULT_SIDE);
    expect(parseSideState("null")).toEqual(DEFAULT_SIDE);
    expect(parseSideState('{"panel":"monitor","collapsed":"yes"}')).toEqual(DEFAULT_SIDE);
  });
});

describe("railClick", () => {
  it("shows another panel, unfolding the column", () => {
    expect(railClick({ panel: "explorer", collapsed: true }, "snippets")).toEqual({
      panel: "snippets",
      collapsed: false,
    });
  });

  it("folds and unfolds the column on the panel already shown", () => {
    const folded = railClick(DEFAULT_SIDE, "explorer");
    expect(folded).toEqual({ panel: "explorer", collapsed: true });
    expect(railClick(folded, "explorer")).toEqual(DEFAULT_SIDE);
  });
});

describe("side state persistence", () => {
  it("remembers what was saved", () => {
    saveSideState({ panel: "search", collapsed: false });
    expect(loadSideState()).toEqual({ panel: "search", collapsed: false });
  });
});
