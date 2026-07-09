import { describe, it, expect } from "vitest";
import {
  classifyType,
  formatCell,
  boolTo01,
  cellAlign,
  NULL_LABEL,
} from "../../src/utils/format";

describe("classifyType", () => {
  it("maps numeric types to number", () => {
    expect(classifyType("int")).toBe("number");
    expect(classifyType("float")).toBe("number");
  });

  it("maps bool, blob and temporal families", () => {
    expect(classifyType("bool")).toBe("bool");
    expect(classifyType("blob")).toBe("blob");
    expect(classifyType("date")).toBe("temporal");
    expect(classifyType("time")).toBe("temporal");
    expect(classifyType("timestamp")).toBe("temporal");
  });

  it("treats text, json, null and unknown as text", () => {
    expect(classifyType("text")).toBe("text");
    expect(classifyType("json")).toBe("text");
    expect(classifyType("null")).toBe("text");
    expect(classifyType("something-new")).toBe("text");
  });

  it("is case-insensitive on the type name", () => {
    expect(classifyType("INT")).toBe("number");
    expect(classifyType("Timestamp")).toBe("temporal");
  });
});

describe("formatCell", () => {
  it("renders a SQL NULL as the NULL label regardless of type", () => {
    expect(formatCell(null, "int")).toEqual({ text: NULL_LABEL, kind: "null" });
    expect(formatCell(null, "text")).toEqual({ text: NULL_LABEL, kind: "null" });
  });

  it("shows the value verbatim with the column's kind", () => {
    expect(formatCell("42", "int")).toEqual({ text: "42", kind: "number" });
    expect(formatCell("alice", "text")).toEqual({ text: "alice", kind: "text" });
  });

  it("preserves empty strings (distinct from NULL)", () => {
    expect(formatCell("", "text")).toEqual({ text: "", kind: "text" });
  });

  it("normalizes boolean/bit values to 0/1", () => {
    expect(formatCell("true", "bool")).toEqual({ text: "1", kind: "bool" });
    expect(formatCell("f", "bool")).toEqual({ text: "0", kind: "bool" });
    expect(formatCell("\x01", "bool")).toEqual({ text: "1", kind: "bool" });
    // a NULL boolean is still NULL, not 0
    expect(formatCell(null, "bool")).toEqual({ text: NULL_LABEL, kind: "null" });
  });
});

describe("boolTo01", () => {
  it("maps the many truthy forms to 1", () => {
    for (const v of ["1", "true", "TRUE", "t", "yes", "Y", "2", "-3"]) {
      expect(boolTo01(v)).toBe("1");
    }
  });
  it("maps the many falsy forms to 0", () => {
    for (const v of ["0", "false", "F", "no", "n", ""]) {
      expect(boolTo01(v)).toBe("0");
    }
  });
  it("reads a raw single bit byte (0x01 -> 1, 0x00 -> 0)", () => {
    expect(boolTo01("\x01")).toBe("1");
    expect(boolTo01("\x00")).toBe("0");
  });
  it("returns an unrecognized value verbatim", () => {
    expect(boolTo01("maybe")).toBe("maybe");
  });
});

describe("cellAlign", () => {
  it("right-aligns numbers, left-aligns the rest", () => {
    expect(cellAlign("number")).toBe("right");
    expect(cellAlign("text")).toBe("left");
    expect(cellAlign("null")).toBe("left");
  });
});
