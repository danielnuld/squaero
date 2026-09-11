import { describe, it, expect } from "vitest";
import { parsePaneSizes, paneSize, savePaneSize } from "../../src/utils/paneSizes";

// Sizes the user drags and expects to find again (issues #491, #494).
describe("paneSizes", () => {
  it("reads a stored map and ignores what is not a size", () => {
    expect(parsePaneSizes('{"usersList":300,"relatedW":1200}')).toEqual({
      usersList: 300,
      relatedW: 1200,
    });
    expect(parsePaneSizes('{"a":"300","b":0,"c":-5,"d":null}')).toEqual({});
  });

  it("survives nothing stored and stored junk", () => {
    expect(parsePaneSizes(null)).toEqual({});
    expect(parsePaneSizes("")).toEqual({});
    expect(parsePaneSizes("not json")).toEqual({});
    expect(parsePaneSizes("[1,2]")).toEqual({});
  });

  it("remembers a size and falls back when there is none", () => {
    expect(paneSize("neverDragged", 224)).toBe(224);
    savePaneSize("usersList", 317.6);
    expect(paneSize("usersList", 224)).toBe(318); // rounded to whole pixels
    savePaneSize("relatedW", 1100);
    expect(paneSize("usersList", 224)).toBe(318); // one pane does not clear another
  });

  it("ignores a size that is not usable", () => {
    savePaneSize("bogus", Number.NaN);
    savePaneSize("bogus2", 0);
    expect(paneSize("bogus", 10)).toBe(10);
    expect(paneSize("bogus2", 10)).toBe(10);
  });
});
