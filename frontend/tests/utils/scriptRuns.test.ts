import { describe, it, expect } from "vitest";
import {
  statementLabel,
  setKind,
  setCount,
  scriptSets,
  pickActiveSet,
  type ScriptSet,
} from "../../src/utils/scriptRuns";
import type { ResultSet, StatementRun } from "../../src/utils/query";

const rows = (n: number): ResultSet => ({
  columns: [{ name: "id", type: "int" }],
  rows: Array.from({ length: n }, (_, i) => [String(i)]),
  truncated: false,
  rowsAffected: 0,
});

const wrote = (n: number): ResultSet => ({
  columns: [],
  rows: [],
  truncated: false,
  rowsAffected: n,
});

const set = (over: Partial<ScriptSet> = {}): ScriptSet => ({
  sql: "SELECT 1",
  label: "SELECT",
  result: rows(1),
  error: null,
  elapsedMs: 1,
  ...over,
});

describe("statementLabel", () => {
  it("names a SELECT after the table it reads", () => {
    expect(statementLabel("SELECT * FROM ventas.clientes", "mysql")).toBe("clientes");
  });

  it("falls back to the leading keyword", () => {
    expect(statementLabel("UPDATE clientes SET activo = 0", "mysql")).toBe("UPDATE");
    expect(statementLabel("  create table t (id int)", "mysql")).toBe("CREATE");
  });

  it("never comes back empty", () => {
    expect(statementLabel("", "mysql")).toBe("SQL");
    expect(statementLabel("   ", "mysql")).toBe("SQL");
  });
});

describe("setKind / setCount", () => {
  it("tells a result set from a write from a failure", () => {
    expect(setKind(set())).toBe("rows");
    expect(setKind(set({ result: wrote(5) }))).toBe("affected");
    expect(setKind(set({ result: null, error: "boom" }))).toBe("error");
  });

  it("counts the rows returned, or the rows written", () => {
    expect(setCount(set({ result: rows(12) }))).toBe(12);
    expect(setCount(set({ result: wrote(5) }))).toBe(5);
    expect(setCount(set({ result: null, error: "boom" }))).toBe(0);
  });

  it("reads a SELECT that matched nothing as a result set, not as a write", () => {
    // Zero rows with columns is still "here are your rows" — calling it
    // "0 affected" would say the statement wrote something.
    expect(setKind(set({ result: rows(0) }))).toBe("rows");
  });
});

describe("scriptSets", () => {
  const run = (over: Partial<StatementRun> = {}): StatementRun => ({
    sql: "SELECT * FROM clientes",
    result: rows(2),
    elapsedMs: 4,
    ...over,
  });

  it("keeps one entry per statement, in execution order", () => {
    const sets = scriptSets(
      [run(), run({ sql: "UPDATE clientes SET activo = 0", result: wrote(5) })],
      "mysql",
    );
    expect(sets.map((s) => s.label)).toEqual(["clientes", "UPDATE"]);
    expect(sets.map((s) => s.error)).toEqual([null, null]);
  });

  it("turns a statement's error into text and leaves the rest alone", () => {
    const sets = scriptSets(
      [run(), run({ sql: "DELETE FROM pedidoss", result: null, error: new Error("tabla desconocida") })],
      "mysql",
    );
    expect(sets[0].error).toBeNull();
    expect(sets[0].result).not.toBeNull();
    expect(sets[1].error).toContain("tabla desconocida");
  });
});

describe("pickActiveSet", () => {
  it("opens the statement that failed — it is the one to act on", () => {
    const sets = [set(), set({ result: null, error: "boom" }), set()];
    expect(pickActiveSet(sets)).toBe(1);
  });

  it("otherwise opens the first that returned rows: a script is read from the top", () => {
    expect(pickActiveSet([set({ result: wrote(3) }), set(), set()])).toBe(1);
  });

  it("falls back to the first statement when nothing returned rows", () => {
    expect(pickActiveSet([set({ result: wrote(3) }), set({ result: wrote(1) })])).toBe(0);
    expect(pickActiveSet([])).toBe(0);
  });
});
