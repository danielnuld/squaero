import { describe, it, expect } from "vitest";
import {
  nextSnippetId,
  addSnippet,
  renameSnippet,
  removeSnippet,
  mergeSnippets,
  insertIntoText,
  serializeSnippets,
  parseSnippets,
  type Snippet,
} from "../../src/utils/snippets";

const snip = (id: string, name: string, body: string): Snippet => ({ id, name, body });

describe("nextSnippetId", () => {
  it("allocates the next snip-N", () => {
    expect(nextSnippetId([])).toBe("snip-1");
    expect(nextSnippetId([snip("snip-1", "a", "x"), snip("snip-4", "b", "y")])).toBe("snip-5");
  });
});

describe("addSnippet", () => {
  it("appends a new snippet with a fresh id and trimmed name", () => {
    const list = addSnippet([], "  Recientes  ", "SELECT 1");
    expect(list).toEqual([snip("snip-1", "Recientes", "SELECT 1")]);
  });

  it("rejects a blank name or body", () => {
    expect(addSnippet([], "  ", "SELECT 1")).toEqual([]);
    expect(addSnippet([], "n", "   ")).toEqual([]);
  });
});

describe("renameSnippet / removeSnippet", () => {
  const base = [snip("snip-1", "a", "x"), snip("snip-2", "b", "y")];

  it("renames by id and ignores a blank name", () => {
    expect(renameSnippet(base, "snip-2", " B2 ")[1].name).toBe("B2");
    expect(renameSnippet(base, "snip-2", "  ")).toEqual(base);
  });

  it("removes by id", () => {
    expect(removeSnippet(base, "snip-1")).toEqual([snip("snip-2", "b", "y")]);
  });
});

describe("mergeSnippets", () => {
  it("adds incoming with fresh ids and skips verbatim duplicates", () => {
    const current = [snip("snip-1", "a", "SELECT 1")];
    const incoming = [
      snip("snip-1", "a", "SELECT 1"), // duplicate name+body -> skipped
      snip("snip-9", "c", "SELECT 3"), // new -> re-id to snip-2
    ];
    expect(mergeSnippets(current, incoming)).toEqual([
      snip("snip-1", "a", "SELECT 1"),
      snip("snip-2", "c", "SELECT 3"),
    ]);
  });

  it("drops malformed incoming entries", () => {
    const incoming = [
      { name: "  ", body: "x" } as Snippet,
      { name: "ok", body: "   " } as Snippet,
    ];
    expect(mergeSnippets([], incoming)).toEqual([]);
  });
});

describe("insertIntoText", () => {
  it("inserts at a collapsed cursor", () => {
    expect(insertIntoText("AC", 1, 1, "B")).toEqual({ text: "ABC", cursor: 2 });
  });

  it("replaces a selection", () => {
    expect(insertIntoText("A___C", 1, 4, "B")).toEqual({ text: "ABC", cursor: 2 });
  });

  it("clamps out-of-range offsets", () => {
    expect(insertIntoText("AB", 5, -1, "X")).toEqual({ text: "X", cursor: 1 });
  });
});

describe("serializeSnippets / parseSnippets", () => {
  it("round-trips", () => {
    const list = [snip("snip-1", "a", "SELECT 1"), snip("snip-2", "b", "SELECT 2")];
    expect(parseSnippets(serializeSnippets(list))).toEqual(list);
  });

  it("returns [] for null/garbage/non-array and drops malformed entries", () => {
    expect(parseSnippets(null)).toEqual([]);
    expect(parseSnippets("nope")).toEqual([]);
    expect(parseSnippets("{}")).toEqual([]);
    const raw = JSON.stringify([
      { id: "snip-1", name: "a", body: "x" },
      { id: 5, name: "b", body: "y" },
    ]);
    expect(parseSnippets(raw)).toEqual([snip("snip-1", "a", "x")]);
  });
});
