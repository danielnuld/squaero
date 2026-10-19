import { describe, it, expect } from "vitest";
import {
  splitStatements,
  pickRunTarget,
  statementAt,
  errorOffset,
  runButtonLabel,
  runChoices,
  type RunInfo,
  isCommentOnly,
  runnableStatements,
} from "../../src/utils/runScope";

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
    expect(pickRunTarget(doc, 0, 8)).toEqual({ text: "SELECT 1", scope: "selection", from: 0, to: 8 });
  });

  it("normalizes a reversed selection range", () => {
    const doc = "SELECT 1; SELECT 2";
    expect(pickRunTarget(doc, 8, 0)).toEqual({ text: "SELECT 1", scope: "selection", from: 0, to: 8 });
  });

  it("runs the only statement when nothing is selected", () => {
    const doc = "SELECT * FROM t";
    expect(pickRunTarget(doc, 5, 5)).toEqual({ text: doc, scope: "statement", from: 0, to: doc.length });
  });

  it("runs the statement under the cursor, never the others", () => {
    const doc = "SELECT 1;\nSELECT 2;\nUPDATE t SET a = 1;";
    expect(pickRunTarget(doc, 2, 2).text).toBe("SELECT 1");
    const inSecond = doc.indexOf("SELECT 2") + 2;
    expect(pickRunTarget(doc, inSecond, inSecond)).toMatchObject({ text: "SELECT 2", scope: "statement" });
    expect(pickRunTarget(doc, doc.length, doc.length).text).toBe("UPDATE t SET a = 1");
  });

  it("the range it returns is the slice it runs", () => {
    const doc = "  SELECT 1;\n\n  SELECT 2  ";
    const target = pickRunTarget(doc, doc.length - 1, doc.length - 1);
    expect(doc.slice(target.from, target.to)).toBe(target.text);
    expect(target.text).toBe("SELECT 2");
  });

  it("runs the whole script when asked for it, selection or not", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    expect(pickRunTarget(doc, 0, 0, "document")).toEqual({
      text: doc,
      scope: "document",
      from: 0,
      to: doc.length,
    });
    expect(pickRunTarget(doc, 0, 8, "document").scope).toBe("document");
  });

  it("asked for the statement, ignores a selection", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    expect(pickRunTarget(doc, 0, 3, "statement")).toMatchObject({ text: "SELECT 1", scope: "statement" });
  });

  it("asked for a selection that is not there, runs the statement", () => {
    expect(pickRunTarget("SELECT 1", 3, 3, "selection").scope).toBe("statement");
  });

  it("still runs one statement when it is the selected one", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    const from = doc.indexOf("SELECT 2");
    expect(pickRunTarget(doc, from, doc.length)).toMatchObject({ text: "SELECT 2;", scope: "selection" });
  });

  it("a blank document runs as a blank document (the caller rejects it)", () => {
    expect(pickRunTarget("  \n", 1, 1)).toEqual({ text: "  \n", scope: "document", from: 0, to: 3 });
  });

  it("keeps a routine body whole as the statement under the cursor", () => {
    const doc = "SELECT 1;\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END;";
    const pos = doc.indexOf("SELECT 2");
    expect(pickRunTarget(doc, pos, pos, undefined, "mysql").text).toBe(
      "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END",
    );
  });
});

describe("statementAt", () => {
  const doc = "SELECT 1;\n\n-- note\nSELECT 2;";
  const slice = (r: { from: number; to: number } | null) => (r ? doc.slice(r.from, r.to) : null);

  it("finds the statement the cursor is in", () => {
    expect(slice(statementAt(doc, doc.indexOf("SELECT 2") + 1))).toBe("-- note\nSELECT 2");
  });

  it("right after a semicolon, is the statement it closes", () => {
    expect(statementAt(doc, doc.indexOf(";") + 1)).toEqual({ from: 0, to: 8 });
  });

  it("on a blank line between statements, is the one before", () => {
    expect(statementAt(doc, doc.indexOf("\n\n") + 1)).toEqual({ from: 0, to: 8 });
  });

  it("before the first statement, is the first", () => {
    expect(statementAt("\n\nSELECT 1", 0)).toEqual({ from: 2, to: 10 });
  });

  it("is null when nothing is runnable", () => {
    expect(statementAt("", 0)).toBeNull();
    expect(statementAt("-- only a comment", 3)).toBeNull();
  });
});

// Issue #456: a routine is ONE statement whose body is full of semicolons.
// Splitting on them is what made a procedure's own DDL impossible to run back.
describe("splitStatements keeps a routine body whole", () => {
  const proc = [
    "CREATE DEFINER=`root`@`%` PROCEDURE `alta`(IN n INT)",
    "BEGIN",
    "  DECLARE x INT;",
    "  SET x = n;",
    "  IF x > 0 THEN",
    "    INSERT INTO t (a) VALUES (x);",
    "  END IF;",
    "END",
  ].join("\n");

  it("does not split a MySQL procedure at its inner semicolons", () => {
    const stmts = splitStatements(`DROP PROCEDURE IF EXISTS alta;\n${proc};`, "mysql");
    const texts = stmts.map((s) => s.text.trim()).filter((s) => s !== "");
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe("DROP PROCEDURE IF EXISTS alta");
    expect(texts[1]).toBe(proc);
  });

  it("keeps splitting whatever follows the routine", () => {
    const texts = splitStatements(`${proc};\nSELECT 1;\nSELECT 2`, "mysql")
      .map((s) => s.text.trim())
      .filter((s) => s !== "");
    expect(texts).toEqual([proc, "SELECT 1", "SELECT 2"]);
  });

  it("counts nested BEGIN…END, so the body ends at the LAST end", () => {
    const nested = "CREATE PROCEDURE p() BEGIN BEGIN SELECT 1; END; SELECT 2; END";
    expect(splitStatements(`${nested};SELECT 3`, "mysql").map((s) => s.text.trim())).toEqual([
      nested,
      "SELECT 3",
    ]);
  });

  it("ends a bodyless trigger at its own semicolon", () => {
    // No BEGIN and no END: the first `;` is the terminator, or the rest of the
    // script would be swallowed into it.
    const sql = "CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET @a = 1;\nSELECT 1";
    expect(splitStatements(sql, "mysql").map((s) => s.text.trim())).toEqual([
      "CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET @a = 1",
      "SELECT 1",
    ]);
  });

  it("keeps an Informix body whole, which has no BEGIN at all", () => {
    const spl = [
      "CREATE PROCEDURE alta(n INT)",
      "  DEFINE x INT;",
      "  LET x = n;",
      "  INSERT INTO t VALUES (x);",
      "END PROCEDURE",
    ].join("\n");
    expect(splitStatements(`${spl};\nSELECT 1`, "informix").map((s) => s.text.trim())).toEqual([
      spl,
      "SELECT 1",
    ]);
  });

  it("leaves an Informix trigger, which has no END, ending at its semicolon", () => {
    const sql = "CREATE TRIGGER t UPDATE ON tab REFERENCING NEW AS n FOR EACH ROW (UPDATE o SET a = 1);\nSELECT 1";
    expect(splitStatements(sql, "informix").map((s) => s.text.trim())).toHaveLength(2);
  });

  it("ignores semicolons inside a dollar-quoted body (Postgres)", () => {
    const fn = [
      "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$",
      "BEGIN",
      "  PERFORM 1; PERFORM 2;",
      "  RETURN 1;",
      "END;",
      "$$ LANGUAGE plpgsql",
    ].join("\n");
    expect(splitStatements(`${fn};\nSELECT 1`, "postgres").map((s) => s.text.trim())).toEqual([
      fn,
      "SELECT 1",
    ]);
  });

  it("does not take a plain BEGIN block for a routine", () => {
    expect(splitStatements("BEGIN; UPDATE t SET a = 1; COMMIT;").map((s) => s.text.trim())).toEqual(
      ["BEGIN", "UPDATE t SET a = 1", "COMMIT", ""],
    );
  });
});

describe("isCommentOnly (issue #653)", () => {
  it("is true for -- and /* */ comments with whitespace, on every engine", () => {
    for (const engine of [undefined, "sqlite", "postgres", "mysql", "informix", "sqlserver"]) {
      expect(isCommentOnly("   -- 2", engine)).toBe(true);
      expect(isCommentOnly("/* a\nb */\n-- c\n", engine)).toBe(true);
      expect(isCommentOnly("", engine)).toBe(true);
    }
  });

  it("is false when a statement is there, even with comments around it", () => {
    expect(isCommentOnly("-- x\nSELECT 1 /* y */")).toBe(false);
    expect(isCommentOnly("SELECT '--'")).toBe(false);
  });

  it("knows # on MySQL/MariaDB only", () => {
    expect(isCommentOnly("# note", "mysql")).toBe(true);
    expect(isCommentOnly("# note", "mariadb")).toBe(true);
    expect(isCommentOnly("# note", "postgres")).toBe(false);
  });

  it("knows { } on Informix only", () => {
    expect(isCommentOnly("{ note }", "informix")).toBe(true);
    expect(isCommentOnly("{ note }", "postgres")).toBe(false);
  });
});

describe("runnableStatements (issue #653)", () => {
  it("drops a trailing comment after ';' instead of running it", () => {
    expect(runnableStatements("SELECT 1; -- x", "informix")).toEqual(["SELECT 1"]);
  });

  it("runs only the real statements of a commented script, on every engine", () => {
    const sql = [
      "-- 1) parent",
      "DELETE FROM a WHERE id IN (1, 2);   -- 2",
      "DELETE FROM b WHERE id = 1;   /* 1 */",
      "",
      "-- 2) children",
      "DELETE FROM c WHERE id = 1;   -- 1",
    ].join("\n");
    for (const engine of ["sqlite", "postgres", "mysql", "informix", "sqlserver", "oracle"]) {
      expect(runnableStatements(sql, engine)).toEqual([
        "-- 1) parent\nDELETE FROM a WHERE id IN (1, 2)",
        "-- 2\nDELETE FROM b WHERE id = 1",
        "/* 1 */\n\n-- 2) children\nDELETE FROM c WHERE id = 1",
      ]);
    }
  });

  it("keeps an inner comment inside a statement as is", () => {
    expect(runnableStatements("SELECT 1 -- x;y\n; SELECT 2")).toEqual(["SELECT 1 -- x;y", "SELECT 2"]);
  });

  it("drops engine-specific trailing comments", () => {
    expect(runnableStatements("SELECT 1; # x", "mysql")).toEqual(["SELECT 1"]);
    expect(runnableStatements("SELECT 1; { x }", "informix")).toEqual(["SELECT 1"]);
  });
});

describe("errorOffset", () => {
  const doc = "SELECT 1;\nSELECT *\nFORM t\nWHERE a = 1;";
  const stmt = "SELECT *\nFORM t\nWHERE a = 1";

  it("is the start of the statement when no line is named", () => {
    expect(errorOffset(doc, stmt, null)).toBe(doc.indexOf("SELECT *"));
    expect(errorOffset(doc, stmt, 1)).toBe(doc.indexOf("SELECT *"));
  });

  it("is the start of the blamed line inside the statement", () => {
    expect(errorOffset(doc, stmt, 2)).toBe(doc.indexOf("FORM"));
    expect(errorOffset(doc, stmt, 3)).toBe(doc.indexOf("WHERE"));
  });

  it("falls back to the statement for a line past its end", () => {
    expect(errorOffset(doc, stmt, 9)).toBe(doc.indexOf("SELECT *"));
  });

  it("finds the statement despite the whitespace trimmed off when it was sent", () => {
    expect(errorOffset(doc, `  ${stmt}\n`, null)).toBe(doc.indexOf("SELECT *"));
  });

  it("is null when the document no longer holds it", () => {
    expect(errorOffset(doc, "DELETE FROM t", null)).toBeNull();
    expect(errorOffset(doc, "  ", null)).toBeNull();
  });
});

describe("run button and its menu (R-04)", () => {
  const info = (over: Partial<RunInfo> = {}): RunInfo => ({
    hasSelection: false,
    statement: { first: 2, last: 5 },
    statements: 2,
    ...over,
  });

  it("names the statement, or the selection when there is one", () => {
    expect(runButtonLabel(info())).toBe("editor.runStatement");
    expect(runButtonLabel(info({ hasSelection: true }))).toBe("editor.runSelection");
  });

  it("offers the statement under the cursor as what Ctrl+Enter runs", () => {
    const [stmt, sel, script] = runChoices(info());
    expect(stmt).toMatchObject({
      scope: "statement",
      hint: { key: "editor.scope.lines", params: { from: 2, to: 5 } },
      keys: "Mod+Enter",
      current: true,
      disabled: false,
    });
    expect(sel).toMatchObject({ scope: "selection", disabled: true, current: false, keys: "" });
    expect(sel.hint.key).toBe("editor.scope.noSelection");
    expect(script).toMatchObject({
      scope: "document",
      hint: { key: "editor.scope.statements", params: { n: 2 } },
      keys: "Mod+Shift+Enter",
      current: false,
    });
  });

  it("with a selection, Ctrl+Enter is the selection's", () => {
    const [stmt, sel] = runChoices(info({ hasSelection: true }));
    expect(stmt).toMatchObject({ current: false, keys: "", disabled: false });
    expect(sel).toMatchObject({ current: true, keys: "Mod+Enter", disabled: false });
    expect(sel.hint.key).toBe("editor.scope.selected");
  });

  it("says one line, one statement, in the singular", () => {
    const [stmt, , script] = runChoices(info({ statement: { first: 3, last: 3 }, statements: 1 }));
    expect(stmt.hint).toEqual({ key: "editor.scope.line", params: { n: 3 } });
    expect(script.hint).toEqual({ key: "editor.scope.statementsOne" });
  });

  it("disables what an empty editor cannot run", () => {
    const [stmt, sel, script] = runChoices(info({ statement: null, statements: 0 }));
    expect(stmt).toMatchObject({ disabled: true, hint: { key: "editor.scope.nothing" } });
    expect(sel.disabled).toBe(true);
    expect(script.disabled).toBe(true);
  });
});
