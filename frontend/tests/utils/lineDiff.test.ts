import { describe, it, expect } from "vitest";
import { diffLines, MAX_DIFF_CELLS } from "../../src/utils/lineDiff";

const render = (a: string, b: string) =>
  diffLines(a, b)?.map((l) => (l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ") + l.text);

describe("diffLines", () => {
  it("marks a changed line in the middle as removed then added", () => {
    expect(render("SELECT *\nFROM a\nWHERE x = 1", "SELECT *\nFROM b\nWHERE x = 1")).toEqual([
      " SELECT *",
      "-FROM a",
      "+FROM b",
      " WHERE x = 1",
    ]);
  });

  it("finds insertions and deletions around unchanged lines", () => {
    expect(render("a\nb\nc\nd", "a\nc\nd\ne")).toEqual([" a", "-b", " c", " d", "+e"]);
    expect(render("x\na\ny", "a")).toEqual(["-x", " a", "-y"]);
  });

  it("identical texts are all `same`", () => {
    expect(render("a\nb", "a\nb")).toEqual([" a", " b"]);
  });

  it("empty on either side is all added / all removed; both empty is nothing", () => {
    expect(render("", "a\nb")).toEqual(["+a", "+b"]);
    expect(render("a\nb", "")).toEqual(["-a", "-b"]);
    expect(render("", "")).toEqual([]);
  });

  it("treats CRLF and LF line endings alike", () => {
    expect(render("a\r\nb", "a\nb")).toEqual([" a", " b"]);
  });

  it("handles a huge text with a small change (common head/tail stripped)", () => {
    const big = Array.from({ length: 50_000 }, (_, i) => `line ${i}`);
    const changed = [...big];
    changed[25_000] = "changed";
    const out = diffLines(big.join("\n"), changed.join("\n"))!;
    expect(out.filter((l) => l.kind !== "same")).toEqual([
      { kind: "del", text: "line 25000" },
      { kind: "add", text: "changed" },
    ]);
  });

  it("refuses (null) rather than approximating when the changed middle is too big", () => {
    const side = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1;
    const a = Array.from({ length: side }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: side }, (_, i) => `b${i}`).join("\n");
    expect(diffLines(a, b)).toBeNull();
  });
});

import { sideBySide, diffSummary } from "../../src/utils/lineDiff";

describe("sideBySide / diffSummary", () => {
  it("pairs a removal run with the additions that replace it", () => {
    const lines = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne")!;
    const rows = sideBySide(lines);
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ["a", "a"],
      ["b", "B"],
      ["c", "c"],
      ["d", "d"],
      [null, "e"],
    ]);
    expect(rows[4].right).toEqual({ no: 5, text: "e", kind: "add" });
    expect(diffSummary(lines)).toEqual({ added: 2, removed: 1 });
  });
  it("leaves the right blank when lines only go", () => {
    const rows = sideBySide(diffLines("a\nb", "a")!);
    expect(rows[1]).toEqual({ left: { no: 2, text: "b", kind: "del" }, right: null });
  });
});
