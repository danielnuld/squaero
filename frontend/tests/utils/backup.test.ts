import { describe, it, expect } from "vitest";
import {
  ddlStatement,
  sqlLiteral,
  insertStatements,
  dumpChunks,
  restoreStatements,
  runRestore,
  type DumpSource,
  type DumpObject,
} from "../../src/utils/backup";
import type { ResultSet } from "../../src/utils/query";

const rows = (names: string[], data: (string | null)[][]): ResultSet => ({
  columns: names.map((name) => ({ name, type: "text" })),
  rows: data,
  truncated: false,
  rowsAffected: 0,
});

const source: DumpSource = {
  ddl: async (name) =>
    name === "v"
      ? "CREATE VIEW v AS SELECT * FROM t"
      : `CREATE TABLE ${name} (id int, note text);;  \n`,
  rows: async (name) =>
    name === "t" ? rows(["id", "note"], [["1", "it's"], ["2", null]]) : rows(["id"], []),
};

const objects: DumpObject[] = [
  { name: "v", kind: "view" },
  { name: "t", kind: "table" },
  { name: "empty", kind: "table" },
];

async function dump(engine: string, structure = true, data = true): Promise<string> {
  let out = "";
  for await (const piece of dumpChunks(source, objects, engine, { structure, data })) out += piece;
  return out;
}

describe("ddlStatement", () => {
  it("ends in exactly one semicolon", () => {
    expect(ddlStatement("CREATE TABLE t (a int)")).toBe("CREATE TABLE t (a int);");
    expect(ddlStatement("  CREATE TABLE t (a int);; \n")).toBe("CREATE TABLE t (a int);");
  });
});

describe("sqlLiteral", () => {
  it("writes NULL as the keyword and doubles quotes", () => {
    expect(sqlLiteral(null, "sqlite")).toBe("NULL");
    expect(sqlLiteral("it's", "postgres")).toBe("'it''s'");
  });

  it("doubles backslashes only on MySQL, which reads them as escapes", () => {
    expect(sqlLiteral("C:\\new", "mysql")).toBe("'C:\\\\new'");
    expect(sqlLiteral("C:\\new", "mariadb")).toBe("'C:\\\\new'");
    expect(sqlLiteral("C:\\new", "postgres")).toBe("'C:\\new'");
  });
});

describe("insertStatements", () => {
  it("quotes identifiers per engine", () => {
    const r = rows(["id"], [["1"]]);
    expect(insertStatements("t", r, "mysql")).toEqual(["INSERT INTO `t` (`id`) VALUES ('1');"]);
    expect(insertStatements("t", r, "postgres")).toEqual(['INSERT INTO "t" ("id") VALUES (\'1\');']);
    expect(insertStatements("t", r, "informix")).toEqual(["INSERT INTO t (id) VALUES ('1');"]);
  });

  it("gives nothing for an empty table", () => {
    expect(insertStatements("t", rows(["id"], []), "sqlite")).toEqual([]);
  });
});

describe("dumpChunks", () => {
  it("writes tables, then rows, then views", async () => {
    const text = await dump("sqlite");
    const createT = text.indexOf("CREATE TABLE t ");
    const insert = text.indexOf('INSERT INTO "t"');
    const view = text.indexOf("CREATE VIEW v");
    expect(createT).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(createT);
    expect(view).toBeGreaterThan(insert);
    expect(text).toContain(`INSERT INTO "t" ("id", "note") VALUES ('2', NULL);`);
    expect(text).not.toContain('INSERT INTO "empty"');
    expect(text).not.toContain("FOREIGN_KEY_CHECKS");
  });

  it("switches MySQL's foreign-key checks off around the dump", async () => {
    const text = await dump("mysql");
    expect(text.startsWith("SET FOREIGN_KEY_CHECKS=0;")).toBe(true);
    expect(text.trimEnd().endsWith("SET FOREIGN_KEY_CHECKS=1;")).toBe(true);
  });

  it("can leave out the data or the structure", async () => {
    const structure = await dump("sqlite", true, false);
    expect(structure).toContain("CREATE TABLE t");
    expect(structure).not.toContain("INSERT");
    const data = await dump("sqlite", false, true);
    expect(data).toContain("INSERT");
    expect(data).not.toContain("CREATE");
  });

  it("splits a large table into pieces", async () => {
    const many = rows(["id"], Array.from({ length: 1201 }, (_, i) => [String(i)]));
    const pieces: string[] = [];
    const src: DumpSource = { ddl: async () => "", rows: async () => many };
    for await (const p of dumpChunks(src, [{ name: "t", kind: "table" }], "sqlite", { structure: false, data: true })) {
      pieces.push(p);
    }
    const inserts = pieces.filter((p) => p.startsWith("INSERT"));
    expect(inserts).toHaveLength(3);
    expect(pieces.join("").match(/INSERT/g)).toHaveLength(1201);
  });

  it("propagates a DDL failure instead of writing a partial object", async () => {
    const src: DumpSource = { ...source, ddl: async () => { throw new Error("unsupported"); } };
    const gen = dumpChunks(src, objects, "sqlite", { structure: true, data: true });
    await expect((async () => { for await (const _ of gen) { /* drain */ } })()).rejects.toThrow("unsupported");
  });

  it("reports each object it reads", async () => {
    const seen: string[] = [];
    for await (const _ of dumpChunks(source, objects, "sqlite", { structure: true, data: true }, (n) => seen.push(n))) {
      /* drain */
    }
    expect(seen).toEqual(["t", "empty", "t", "empty", "v"]);
  });
});

describe("restoreStatements", () => {
  it("reads a dump back into the statements it was made of", async () => {
    const stmts = restoreStatements(await dump("mysql"), "mysql");
    expect(stmts).toHaveLength(7); // SET, 2 CREATE TABLE, 2 INSERT, CREATE VIEW, SET
    expect(stmts[3]).toContain("VALUES ('1', 'it''s')");
  });

  it("keeps a semicolon inside a value within its statement", () => {
    expect(restoreStatements("INSERT INTO t VALUES ('a;b');\nSELECT 1;", "sqlite")).toHaveLength(2);
  });

  it("drops pieces that are only comments, keeping those that lead a statement", () => {
    expect(restoreStatements("-- header\nSELECT 1;\n-- trailing\n/* x */", "sqlite")).toEqual([
      "-- header\nSELECT 1",
    ]);
  });
});

describe("runRestore", () => {
  it("runs every statement in order and reports progress", async () => {
    const ran: string[] = [];
    const progress: number[] = [];
    const report = await runRestore(["a", "b"], async (s) => { ran.push(s); }, (n) => progress.push(n));
    expect(ran).toEqual(["a", "b"]);
    expect(progress).toEqual([1, 2]);
    expect(report).toEqual({ ran: 2, total: 2 });
  });

  it("stops at the first failure and says which statement it was", async () => {
    const ran: string[] = [];
    const report = await runRestore(["a", "bad", "c"], async (s) => {
      if (s === "bad") throw new Error("syntax");
      ran.push(s);
    });
    expect(ran).toEqual(["a"]);
    expect(report.ran).toBe(1);
    expect(report.failed?.index).toBe(2);
    expect(report.failed?.statement).toBe("bad");
    expect((report.failed?.error as Error).message).toBe("syntax");
  });
});
