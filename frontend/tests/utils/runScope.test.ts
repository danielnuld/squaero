import { describe, it, expect } from "vitest";
import { splitStatements, pickRunTarget } from "../../src/utils/runScope";

describe("splitStatements", () => {
  it("splits on top-level semicolons and covers the whole source", () => {
    const stmts = splitStatements("SELECT 1; SELECT 2");
    expect(stmts.map((s) => s.text)).toEqual(["SELECT 1", " SELECT 2"]);
    expect(stmts[0].from).toBe(0);
    expect(stmts[1].to).toBe("SELECT 1; SELECT 2".length);
  });

  it("keeps a trailing semicolon-less statement", () => {
    expect(splitStatements("SELECT 1").map((s) => s.text)).toEqual(["SELECT 1"]);
  });

  it("ignores semicolons inside single-quoted strings", () => {
    expect(splitStatements("SELECT ';'; SELECT 2").map((s) => s.text)).toEqual([
      "SELECT ';'",
      " SELECT 2",
    ]);
  });

  it("handles escaped quotes inside a string", () => {
    expect(splitStatements("SELECT 'a''; b'; SELECT 2").map((s) => s.text)).toEqual([
      "SELECT 'a''; b'",
      " SELECT 2",
    ]);
  });

  it("ignores semicolons inside quoted identifiers", () => {
    expect(splitStatements('SELECT "a;b"; SELECT 2').map((s) => s.text)).toEqual([
      'SELECT "a;b"',
      " SELECT 2",
    ]);
  });

  it("ignores semicolons inside backtick identifiers (MySQL)", () => {
    expect(splitStatements("SELECT 1 FROM `weird;table`; SELECT 2").map((s) => s.text)).toEqual([
      "SELECT 1 FROM `weird;table`",
      " SELECT 2",
    ]);
  });

  it("handles a backslash-escaped quote inside a string (MySQL default)", () => {
    expect(
      splitStatements("UPDATE t SET n = 'O\\'Brien; Jr' WHERE id=1; SELECT 2").map((s) => s.text),
    ).toEqual(["UPDATE t SET n = 'O\\'Brien; Jr' WHERE id=1", " SELECT 2"]);
  });

  it("ignores semicolons inside line comments", () => {
    expect(splitStatements("SELECT 1 -- x;y\n; SELECT 2").map((s) => s.text)).toEqual([
      "SELECT 1 -- x;y\n",
      " SELECT 2",
    ]);
  });

  it("ignores semicolons inside block comments", () => {
    expect(splitStatements("SELECT 1 /* a;b */; SELECT 2").map((s) => s.text)).toEqual([
      "SELECT 1 /* a;b */",
      " SELECT 2",
    ]);
  });

  it("produces empty segments between adjacent separators", () => {
    expect(splitStatements("SELECT 1;;SELECT 2").map((s) => s.text)).toEqual([
      "SELECT 1",
      "",
      "SELECT 2",
    ]);
  });
});

describe("pickRunTarget", () => {
  it("runs the selection verbatim when one exists", () => {
    const doc = "SELECT 1; SELECT 2";
    expect(pickRunTarget(doc, 0, 8)).toEqual({ text: "SELECT 1", scope: "selection" });
  });

  it("normalizes a reversed selection range", () => {
    const doc = "SELECT 1; SELECT 2";
    expect(pickRunTarget(doc, 8, 0)).toEqual({ text: "SELECT 1", scope: "selection" });
  });

  it("runs the whole document when nothing is selected", () => {
    const doc = "SELECT * FROM t";
    expect(pickRunTarget(doc, 5, 5)).toEqual({ text: doc, scope: "document" });
  });

  it("runs the WHOLE document with several statements, wherever the cursor is", () => {
    // It used to run only the statement under the cursor, so writing three
    // queries and pressing Ejecutar ran one of them in silence.
    const doc = "SELECT 1;\nSELECT 2;\nUPDATE t SET a = 1;";
    expect(pickRunTarget(doc, 2, 2)).toEqual({ text: doc, scope: "document" });
    const inSecond = doc.indexOf("SELECT 2") + 2;
    expect(pickRunTarget(doc, inSecond, inSecond)).toEqual({ text: doc, scope: "document" });
    expect(pickRunTarget(doc, doc.length, doc.length)).toEqual({ text: doc, scope: "document" });
  });

  it("still runs one statement when it is the selected one", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    const from = doc.indexOf("SELECT 2");
    expect(pickRunTarget(doc, from, doc.length)).toEqual({
      text: "SELECT 2;",
      scope: "selection",
    });
  });
});
