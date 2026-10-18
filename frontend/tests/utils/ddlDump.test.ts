import { describe, it, expect, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  buildDumpZip,
  normalizeDdl,
  planDdlDump,
  readDdl,
  safeFileName,
  type DdlObject,
} from "../../src/utils/ddlDump";

const obj = (kind: DdlObject["kind"], name: string, ddl: string | null = `CREATE X ${name}`): DdlObject => ({
  kind,
  name,
  ddl,
});

describe("safeFileName", () => {
  it("keeps an ordinary name", () => {
    expect(safeFileName("customers")).toBe("customers");
    expect(safeFileName("order items")).toBe("order items");
  });

  it("replaces what Windows forbids, slashes included", () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(safeFileName("tab\tname\u0000")).toBe("tab_name_");
  });

  it("keeps quotes Windows allows and unicode, NFC-normalized", () => {
    expect(safeFileName("o'brien")).toBe("o'brien");
    expect(safeFileName("año")).toBe("año");
    expect(safeFileName("año")).toBe("año");
    expect(safeFileName("表")).toBe("表");
  });

  it("guards device names, with or without extension, in any case", () => {
    for (const n of ["CON", "prn", "Aux", "NUL", "COM1", "lpt9", "con.backup"]) {
      expect(safeFileName(n)).toBe(`_${n}`);
    }
    expect(safeFileName("CONSOLE")).toBe("CONSOLE");
    expect(safeFileName("COM0")).toBe("COM0");
  });

  it("turns trailing dots and spaces into underscores", () => {
    expect(safeFileName("name.")).toBe("name_");
    expect(safeFileName("name. ")).toBe("name__");
    expect(safeFileName("..")).toBe("__");
  });

  it("is never empty", () => {
    expect(safeFileName("")).toBe("_");
  });

  it("cuts very long names by code point", () => {
    expect(Array.from(safeFileName("😀".repeat(300)))).toHaveLength(120);
  });
});

describe("normalizeDdl", () => {
  it("uses LF, one semicolon and one trailing newline", () => {
    expect(normalizeDdl("CREATE TABLE t (\r\n  a int\r\n);;\r\n\r\n")).toBe("CREATE TABLE t (\n  a int\n);\n");
    expect(normalizeDdl("CREATE VIEW v AS SELECT 1\r")).toBe("CREATE VIEW v AS SELECT 1;\n");
  });
});

describe("planDdlDump", () => {
  it("puts each kind in its folder, sorted by path", () => {
    const plan = planDdlDump([
      obj("trigger", "trg"),
      obj("view", "v"),
      obj("table", "b"),
      obj("table", "a"),
      obj("procedure", "p"),
      obj("function", "f"),
      obj("event", "e"),
    ]);
    expect(plan.files.map((f) => f.path)).toEqual([
      "events/e.sql",
      "functions/f.sql",
      "procedures/p.sql",
      "tables/a.sql",
      "tables/b.sql",
      "triggers/trg.sql",
      "views/v.sql",
    ]);
    expect(plan.files[3].content).toBe("CREATE X a;\n");
    expect(plan.skipped).toEqual([]);
  });

  it("is the same whatever order the objects arrive in", () => {
    const objs = [obj("table", "users"), obj("table", "Users"), obj("table", "a/b"), obj("table", "a_b"), obj("view", "z")];
    const a = planDdlDump(objs);
    const b = planDdlDump([...objs].reverse());
    expect(b).toEqual(a);
  });

  it("tells apart names that clash on a case-insensitive disk", () => {
    const plan = planDdlDump([obj("table", "users"), obj("table", "Users"), obj("table", "USERS")]);
    expect(plan.files.map((f) => [f.path, f.content])).toEqual([
      ["tables/USERS.sql", "CREATE X USERS;\n"],
      ["tables/Users~2.sql", "CREATE X Users;\n"],
      ["tables/users~3.sql", "CREATE X users;\n"],
    ]);
  });

  it("tells apart names that clash once made safe, and a name that looks like a suffix", () => {
    const plan = planDdlDump([obj("table", "a/b"), obj("table", "a_b"), obj("table", "a_b~2")]);
    expect(plan.files.map((f) => f.path)).toEqual(["tables/a_b.sql", "tables/a_b~2.sql", "tables/a_b~2~2.sql"]);
  });

  it("orders overloaded routines of one name by their DDL", () => {
    const plan = planDdlDump([
      obj("function", "f", "CREATE FUNCTION f(b int)"),
      obj("function", "f", "CREATE FUNCTION f(a int)"),
    ]);
    expect(plan.files).toEqual([
      { path: "functions/f.sql", content: "CREATE FUNCTION f(a int);\n" },
      { path: "functions/f~2.sql", content: "CREATE FUNCTION f(b int);\n" },
    ]);
  });

  it("does not let the same name in different kinds collide", () => {
    const plan = planDdlDump([obj("table", "x"), obj("view", "x")]);
    expect(plan.files.map((f) => f.path)).toEqual(["tables/x.sql", "views/x.sql"]);
  });

  it("reports objects without DDL instead of leaving them out", () => {
    const plan = planDdlDump([
      obj("table", "ok"),
      obj("table", "blank", "  \n"),
      { kind: "view", name: "v", ddl: null, reason: "Unsupported" },
    ]);
    expect(plan.files.map((f) => f.path)).toEqual(["tables/ok.sql"]);
    expect(plan.skipped).toEqual([
      { kind: "table", name: "blank", reason: undefined },
      { kind: "view", name: "v", reason: "Unsupported" },
    ]);
  });

  it("plans nothing for an empty schema", () => {
    expect(planDdlDump([])).toEqual({ files: [], skipped: [] });
  });
});

describe("readDdl", () => {
  it("reads every job and turns a failure into a reason, without stopping", async () => {
    const seen: string[] = [];
    const out = await readDdl(
      [
        { kind: "table", name: "a", read: async () => "CREATE TABLE a" },
        { kind: "table", name: "b", read: async () => Promise.reject(new Error("-32001 unsupported")) },
        { kind: "view", name: "v", read: async () => "CREATE VIEW v" },
      ],
      (err) => (err as Error).message,
      (done, name) => seen.push(`${done}:${name}`),
    );
    expect(out).toEqual([
      { kind: "table", name: "a", ddl: "CREATE TABLE a" },
      { kind: "table", name: "b", ddl: null, reason: "-32001 unsupported" },
      { kind: "view", name: "v", ddl: "CREATE VIEW v" },
    ]);
    expect(seen).toEqual(["0:a", "1:b", "2:v"]);
  });
});

describe("buildDumpZip", () => {
  const files = [
    { path: "tables/año.sql", content: "CREATE TABLE año (a int);\n" },
    { path: "views/v.sql", content: "CREATE VIEW v AS SELECT 1;\n" },
  ];

  it("holds the same folder structure and contents", () => {
    const entries = unzipSync(buildDumpZip(files));
    expect(Object.keys(entries).sort()).toEqual(["tables/año.sql", "views/v.sql"]);
    expect(strFromU8(entries["tables/año.sql"])).toBe("CREATE TABLE año (a int);\n");
  });

  it("is byte for byte the same whatever the clock says", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2020, 0, 1));
      const a = buildDumpZip(files);
      vi.setSystemTime(new Date(2026, 5, 15, 12, 30, 7));
      expect(buildDumpZip(files)).toEqual(a);
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds an empty archive for an empty schema", () => {
    expect(Object.keys(unzipSync(buildDumpZip([])))).toEqual([]);
  });
});
