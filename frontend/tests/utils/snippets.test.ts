import { describe, it, expect } from "vitest";
import {
  nextSnippetId,
  addSnippet,
  renameSnippet,
  updateSnippetBody,
  removeSnippet,
  mergeSnippets,
  insertIntoText,
  serializeSnippets,
  parseSnippets,
  type Snippet,
  proposedSnippetName,
  uniqueSnippetName,
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

describe("updateSnippetBody", () => {
  const base = [snip("snip-1", "a", "SELECT 1"), snip("snip-2", "b", "SELECT 2")];

  it("replaces the body in place, keeping the id and the name", () => {
    expect(updateSnippetBody(base, "snip-2", "SELECT 22")).toEqual([
      snip("snip-1", "a", "SELECT 1"),
      snip("snip-2", "b", "SELECT 22"),
    ]);
  });

  it("ignores a blank body, so a stray save cannot empty a saved query", () => {
    expect(updateSnippetBody(base, "snip-1", "   ")).toEqual(base);
    expect(updateSnippetBody(base, "snip-1", "")).toEqual(base);
  });

  it("leaves the list alone for an id it does not hold", () => {
    expect(updateSnippetBody(base, "snip-9", "SELECT 9")).toEqual(base);
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

describe("proposedSnippetName", () => {
  it("names a single-table SELECT after its table", () => {
    expect(proposedSnippetName("SELECT * FROM cuadernos WHERE anio = 2026")).toBe("cuadernos");
  });

  it("keeps just the table of a qualified name", () => {
    expect(proposedSnippetName("SELECT * FROM erp:cuadernos", "informix")).toBe("cuadernos");
    expect(proposedSnippetName("SELECT * FROM shop.orders", "mysql")).toBe("orders");
  });

  it("has nothing to propose for a query with no single table", () => {
    expect(proposedSnippetName("SELECT a.x FROM a JOIN b ON b.id = a.id")).toBeNull();
    expect(proposedSnippetName("CREATE TABLE t (id INTEGER)")).toBeNull();
    expect(proposedSnippetName("")).toBeNull();
  });
});

describe("uniqueSnippetName", () => {
  const list = [
    { id: "snip-1", name: "cuadernos", body: "SELECT 1" },
    { id: "snip-2", name: "cuadernos (2)", body: "SELECT 2" },
  ];

  it("keeps a free name as it is", () => {
    expect(uniqueSnippetName(list, "pedidos")).toBe("pedidos");
    expect(uniqueSnippetName([], "cuadernos")).toBe("cuadernos");
  });

  it("numbers a taken name past the variants already in use", () => {
    expect(uniqueSnippetName(list, "cuadernos")).toBe("cuadernos (3)");
  });

  it("trims before deciding, so a padded name is still a duplicate", () => {
    expect(uniqueSnippetName(list, "  cuadernos  ")).toBe("cuadernos (3)");
  });

  it("never overwrites: the existing snippet keeps its name", () => {
    const name = uniqueSnippetName(list, "cuadernos");
    expect(list.some((s) => s.name === name)).toBe(false);
  });
});
