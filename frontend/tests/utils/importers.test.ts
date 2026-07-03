import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseJson,
  parseFile,
  autoMap,
  buildRowValues,
  hasMapping,
  runImport,
  type ImportOps,
  type ParsedTable,
} from "../../src/utils/importers";

/** A recording ImportOps whose insert fails for source rows in `failRows`. */
function fakeOps(failRows: number[] = []) {
  const calls: string[] = [];
  const inserted: Record<string, string | null>[] = [];
  let n = 0;
  const ops: ImportOps = {
    begin: async () => void calls.push("begin"),
    commit: async () => void calls.push("commit"),
    rollback: async () => void calls.push("rollback"),
    insert: async (values) => {
      const i = n++;
      if (failRows.includes(i)) {
        throw new Error(`row ${i} failed`);
      }
      inserted.push(values);
      calls.push("insert");
    },
  };
  return { ops, calls, inserted };
}

describe("parseCsv", () => {
  it("parses a header and rows, CRLF or LF", () => {
    const t = parseCsv("id,name\r\n1,alice\n2,bob");
    expect(t.headers).toEqual(["id", "name"]);
    expect(t.rows).toEqual([
      ["1", "alice"],
      ["2", "bob"],
    ]);
  });

  it("handles quoted fields with delimiters, quotes and newlines", () => {
    const t = parseCsv('a,b\r\n"x,y","he said ""hi"""\r\n"line1\nline2",z');
    expect(t.headers).toEqual(["a", "b"]);
    expect(t.rows).toEqual([
      ["x,y", 'he said "hi"'],
      ["line1\nline2", "z"],
    ]);
  });

  it("does not emit a spurious record for a trailing newline", () => {
    expect(parseCsv("a\n1\n").rows).toEqual([["1"]]);
  });

  it("returns empty for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("parseJson", () => {
  it("unions keys in first-seen order and preserves null", () => {
    const t = parseJson('[{"id":1,"name":"a"},{"id":2,"extra":true,"name":null}]');
    expect(t.headers).toEqual(["id", "name", "extra"]);
    expect(t.rows).toEqual([
      ["1", "a", null], // extra missing -> null
      ["2", null, "true"], // name explicitly null; extra stringified
    ]);
  });

  it("throws on a non-array top level", () => {
    expect(() => parseJson('{"a":1}')).toThrow();
  });
});

describe("parseFile", () => {
  it("dispatches by extension, then by content", () => {
    expect(parseFile("x.json", '[{"a":1}]').headers).toEqual(["a"]);
    expect(parseFile("x.csv", "a\n1").headers).toEqual(["a"]);
    expect(parseFile("noext", '[{"a":1}]').headers).toEqual(["a"]); // sniff JSON
    expect(parseFile("noext", "a,b\n1,2").headers).toEqual(["a", "b"]); // sniff CSV
  });
});

describe("autoMap", () => {
  it("matches target columns to same-named headers, case-insensitively", () => {
    expect(autoMap(["Id", "full_name"], ["id", "name"])).toEqual({
      id: "Id",
      name: null,
    });
  });
});

describe("buildRowValues", () => {
  const headers = ["Id", "name"];
  it("emits only mapped columns, pulling by source header", () => {
    const mapping = { id: "Id", name: "name" };
    expect(buildRowValues(mapping, headers, ["7", "carol"])).toEqual({
      id: "7",
      name: "carol",
    });
  });

  it("skips unmapped targets and carries NULL through", () => {
    const mapping = { id: "Id", note: null };
    expect(buildRowValues(mapping, headers, [null, "x"])).toEqual({ id: null });
  });
});

describe("hasMapping", () => {
  it("is true only when some column is mapped", () => {
    expect(hasMapping({ id: null, name: null })).toBe(false);
    expect(hasMapping({ id: "Id", name: null })).toBe(true);
  });
});

describe("runImport", () => {
  const parsed: ParsedTable = {
    headers: ["id", "name"],
    rows: [
      ["1", "a"],
      ["2", "b"],
      ["3", "c"],
    ],
  };
  const mapping = { id: "id", name: "name" };

  it("inserts every row and commits when all succeed", async () => {
    const { ops, calls, inserted } = fakeOps();
    const summary = await runImport(parsed, mapping, "skip", ops);
    expect(summary).toEqual({ inserted: 3, errors: [], aborted: false });
    expect(inserted[0]).toEqual({ id: "1", name: "a" });
    expect(calls[0]).toBe("begin");
    expect(calls[calls.length - 1]).toBe("commit");
  });

  it("skip policy records the failure, inserts the rest, and commits", async () => {
    const { ops, calls } = fakeOps([1]); // second row fails
    const summary = await runImport(parsed, mapping, "skip", ops);
    expect(summary.inserted).toBe(2);
    expect(summary.errors).toEqual([{ row: 1, message: "row 1 failed" }]);
    expect(summary.aborted).toBe(false);
    expect(calls).toContain("commit");
    expect(calls).not.toContain("rollback");
  });

  it("abort policy rolls back on the first error and applies nothing", async () => {
    const { ops, calls } = fakeOps([1]);
    const summary = await runImport(parsed, mapping, "abort", ops);
    expect(summary.aborted).toBe(true);
    expect(summary.inserted).toBe(0);
    expect(summary.errors).toEqual([{ row: 1, message: "row 1 failed" }]);
    expect(calls).toContain("rollback");
    expect(calls).not.toContain("commit");
  });
});
