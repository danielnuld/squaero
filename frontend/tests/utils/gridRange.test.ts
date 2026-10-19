import { describe, it, expect } from "vitest";
import {
  inRange,
  rangeBetween,
  rangeCellCount,
  rangeToTsv,
  tsvField,
} from "../../src/utils/gridRange";

describe("rangeBetween", () => {
  it("normalizes two corners in any order", () => {
    const want = { r1: 1, c1: 0, r2: 3, c2: 2 };
    expect(rangeBetween({ r: 1, c: 0 }, { r: 3, c: 2 })).toEqual(want);
    expect(rangeBetween({ r: 3, c: 2 }, { r: 1, c: 0 })).toEqual(want);
    expect(rangeBetween({ r: 3, c: 0 }, { r: 1, c: 2 })).toEqual(want);
  });

  it("is one cell when both corners are the same", () => {
    expect(rangeBetween({ r: 2, c: 4 }, { r: 2, c: 4 })).toEqual({ r1: 2, c1: 4, r2: 2, c2: 4 });
  });
});

describe("inRange", () => {
  const rg = { r1: 1, c1: 1, r2: 2, c2: 3 };

  it("includes the edges", () => {
    expect(inRange(rg, 1, 1)).toBe(true);
    expect(inRange(rg, 2, 3)).toBe(true);
  });

  it("excludes what is outside", () => {
    expect(inRange(rg, 0, 1)).toBe(false);
    expect(inRange(rg, 1, 4)).toBe(false);
    expect(inRange(rg, 3, 2)).toBe(false);
  });

  it("is false with no range", () => {
    expect(inRange(null, 0, 0)).toBe(false);
  });
});

describe("rangeCellCount", () => {
  it("counts rows times columns", () => {
    expect(rangeCellCount({ r1: 0, c1: 0, r2: 0, c2: 0 })).toBe(1);
    expect(rangeCellCount({ r1: 1, c1: 2, r2: 3, c2: 3 })).toBe(6);
  });

  it("is 0 with no range", () => {
    expect(rangeCellCount(null)).toBe(0);
  });
});

describe("tsvField", () => {
  it("passes a plain value through", () => {
    expect(tsvField("María López")).toBe("María López");
    expect(tsvField("1250.00")).toBe("1250.00");
  });

  it("turns NULL into an empty field, and keeps '' empty", () => {
    expect(tsvField(null)).toBe("");
    expect(tsvField("")).toBe("");
  });

  it("quotes a value that would break the row, doubling its quotes", () => {
    expect(tsvField("a\tb")).toBe('"a\tb"');
    expect(tsvField("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(tsvField("say \"hi\"")).toBe('"say ""hi"""');
  });
});

describe("rangeToTsv", () => {
  it("joins cells with tabs and rows with newlines", () => {
    expect(
      rangeToTsv([
        ["1", "ana", null],
        ["2", "beto", "x\ty"],
      ]),
    ).toBe('1\tana\t\n2\tbeto\t"x\ty"');
  });

  it("is empty for an empty block", () => {
    expect(rangeToTsv([])).toBe("");
  });
});
