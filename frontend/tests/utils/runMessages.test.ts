import { describe, it, expect } from "vitest";
import { runMessages, appendMessages, type RunMessage } from "../../src/utils/runMessages";
import type { ResultSet } from "../../src/utils/query";

const rows = (n: number): ResultSet => ({
  columns: [{ name: "id", type: "int" }],
  rows: Array.from({ length: n }, (_, i) => [String(i)]),
  truncated: false,
  rowsAffected: 0,
});
const affected = (n: number): ResultSet => ({ columns: [], rows: [], truncated: false, rowsAffected: n });

describe("runMessages", () => {
  it("says how many rows a query returned, with its time", () => {
    expect(
      runMessages({ at: 1000, sql: "SELECT 1", result: rows(3), error: null, elapsedMs: 12 }),
    ).toEqual([{ at: 1000, sql: "SELECT 1", kind: "rows", n: 3, ms: 12 }]);
  });

  it("says how many rows a write affected", () => {
    const [m] = runMessages({ at: 1, sql: "DELETE FROM t", result: affected(2), error: null, elapsedMs: 5 });
    expect(m).toMatchObject({ kind: "affected", n: 2 });
  });

  it("carries the error of a failed run", () => {
    const [m] = runMessages({ at: 1, sql: "SELEC", result: null, error: "syntax error", elapsedMs: null });
    expect(m).toEqual({ at: 1, sql: "SELEC", kind: "error", text: "syntax error" });
  });

  it("lists every statement of a script, in order", () => {
    const lines = runMessages({
      at: 5,
      sql: "a; b; c",
      result: null,
      error: null,
      elapsedMs: 30,
      sets: [
        { sql: "a", result: rows(1), error: null, elapsedMs: 10 },
        { sql: "b", result: affected(4), error: null, elapsedMs: 10 },
        { sql: "c", result: null, error: "boom", elapsedMs: 10 },
      ],
    });
    expect(lines.map((l) => [l.sql, l.kind, l.n ?? l.text])).toEqual([
      ["a", "rows", 1],
      ["b", "affected", 4],
      ["c", "error", "boom"],
    ]);
  });

  it("adds the workspace's warnings after the statements", () => {
    const lines = runMessages({
      at: 1,
      sql: "CREATE TABLE x (a int)",
      result: affected(0),
      error: null,
      elapsedMs: 1,
      warnings: ["implicit commit"],
    });
    expect(lines.map((l) => l.kind)).toEqual(["affected", "warning"]);
    expect(lines[1].text).toBe("implicit commit");
  });

  it("counts a missing result as nothing affected", () => {
    const [m] = runMessages({ at: 1, sql: "X", result: null, error: null, elapsedMs: 0 });
    expect(m).toMatchObject({ kind: "affected", n: 0 });
  });
});

describe("appendMessages", () => {
  const msg = (i: number): RunMessage => ({ at: i, kind: "rows", sql: String(i), n: i });

  it("appends in order", () => {
    expect(appendMessages([msg(1)], [msg(2), msg(3)]).map((m) => m.at)).toEqual([1, 2, 3]);
  });

  it("keeps only the newest lines past the cap", () => {
    const log = appendMessages([msg(1), msg(2), msg(3)], [msg(4)], 3);
    expect(log.map((m) => m.at)).toEqual([2, 3, 4]);
  });

  it("leaves the log it was given untouched", () => {
    const log = [msg(1)];
    appendMessages(log, [msg(2)]);
    expect(log).toHaveLength(1);
  });
});
