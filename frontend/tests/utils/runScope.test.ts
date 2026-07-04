import { describe, it, expect } from "vitest";
import { splitStatements, pickRunTarget, scopeLabel } from "../../src/utils/runScope";

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
    expect(pickRunTarget(doc, 0, 8, 8)).toEqual({ text: "SELECT 1", scope: "selection" });
  });

  it("normalizes a reversed selection range", () => {
    const doc = "SELECT 1; SELECT 2";
    expect(pickRunTarget(doc, 8, 0, 0)).toEqual({ text: "SELECT 1", scope: "selection" });
  });

  it("runs the whole document when it holds a single statement", () => {
    const doc = "SELECT * FROM t";
    expect(pickRunTarget(doc, 5, 5, 5)).toEqual({ text: doc, scope: "document" });
  });

  it("treats a trailing semicolon as a single statement (document)", () => {
    const doc = "SELECT 1;";
    expect(pickRunTarget(doc, 3, 3, 3)).toEqual({ text: doc, scope: "document" });
  });

  it("runs the statement under the cursor for multiple statements", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    // cursor in the first statement
    expect(pickRunTarget(doc, 2, 2, 2)).toEqual({ text: "SELECT 1", scope: "statement" });
    // cursor in the second statement
    const c2 = doc.indexOf("SELECT 2") + 2;
    expect(pickRunTarget(doc, c2, c2, c2)).toEqual({ text: "\nSELECT 2", scope: "statement" });
  });

  it("assigns the gap after a separator to the following statement", () => {
    const doc = "SELECT 1;   \nSELECT 2";
    const between = doc.indexOf("\n"); // whitespace after the first ';'
    expect(pickRunTarget(doc, between, between, between)).toEqual({
      text: "   \nSELECT 2",
      scope: "statement",
    });
  });

  it("runs statement 1 when the cursor sits on its separator", () => {
    const doc = "SELECT 1;\nSELECT 2";
    const semi = doc.indexOf(";");
    expect(pickRunTarget(doc, semi, semi, semi)).toEqual({
      text: "SELECT 1",
      scope: "statement",
    });
  });

  it("resolves a cursor inside an empty segment to the preceding statement", () => {
    const doc = "SELECT 1;;SELECT 3";
    const gap = doc.indexOf(";") + 1; // between the two semicolons
    expect(pickRunTarget(doc, gap, gap, gap)).toEqual({
      text: "SELECT 1",
      scope: "statement",
    });
  });

  it("resolves a cursor past the end to the last statement", () => {
    const doc = "SELECT 1;\nSELECT 2;\n";
    expect(pickRunTarget(doc, doc.length, doc.length, doc.length)).toEqual({
      text: "\nSELECT 2",
      scope: "statement",
    });
  });

  it("returns document scope for an empty document", () => {
    expect(pickRunTarget("", 0, 0, 0)).toEqual({ text: "", scope: "document" });
  });
});

describe("scopeLabel", () => {
  it("maps scopes to Spanish labels", () => {
    expect(scopeLabel("selection")).toBe("selección");
    expect(scopeLabel("statement")).toBe("sentencia");
    expect(scopeLabel("document")).toBe("documento");
  });
});
