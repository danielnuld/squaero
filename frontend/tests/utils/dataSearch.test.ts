import { describe, it, expect } from "vitest";
import {
  clampLimit,
  columnKind,
  likePattern,
  matchLabel,
  planTable,
  runSearch,
  searchRefusal,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type SearchOptions,
} from "../../src/utils/dataSearch";

const opts = (o: Partial<SearchOptions> = {}): SearchOptions => ({
  text: "ana",
  mode: "contains",
  ignoreCase: true,
  numeric: false,
  limit: 50,
  ...o,
});

const cols = { id: "integer", nombre: "varchar(40)" };

const sqlOf = (engine: string, o?: Partial<SearchOptions>, c: Record<string, string> = cols) => {
  const p = planTable({ name: "clientes", db: "ventas" }, c, engine, opts(o));
  if ("skipped" in p) throw new Error(p.skipped);
  return p;
};

describe("searchRefusal", () => {
  it("refuses an empty or blank text", () => {
    expect(searchRefusal("sqlite", opts({ text: "" }))).toBe("ds.emptyText");
    expect(searchRefusal("sqlite", opts({ text: "   " }))).toBe("ds.emptyText");
  });
  it("is honest that MongoDB is not supported", () => {
    expect(searchRefusal("mongodb", opts())).toBe("ds.unsupportedMongo");
  });
  it("accepts a real text on a SQL engine", () => {
    expect(searchRefusal("postgres", opts())).toBeNull();
  });
});

describe("clampLimit", () => {
  it("floors into [1, MAX_LIMIT]", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(12.9)).toBe(12);
    expect(clampLimit(MAX_LIMIT + 1)).toBe(MAX_LIMIT);
  });
  it("falls back to the default for junk", () => {
    expect(clampLimit(NaN)).toBe(DEFAULT_LIMIT);
  });
});

describe("columnKind", () => {
  it("classifies declared text types per engine", () => {
    expect(columnKind("character varying(40)", "postgres")).toBe("text");
    expect(columnKind("TEXT", "sqlite")).toBe("text");
    expect(columnKind("enum('a','b')", "mysql")).toBe("text");
    expect(columnKind("nvarchar(max)", "mssql")).toBe("text");
    expect(columnKind("VARCHAR   ", "informix")).toBe("text");
    expect(columnKind("LVARCHAR", "informix")).toBe("text");
  });
  it("classifies numeric types without catching interval or point", () => {
    expect(columnKind("int(11) unsigned", "mysql")).toBe("number");
    expect(columnKind("double precision", "postgres")).toBe("number");
    expect(columnKind("DECIMAL", "informix")).toBe("number");
    expect(columnKind("interval", "postgres")).toBeNull();
    expect(columnKind("INTERVAL", "informix")).toBeNull();
    expect(columnKind("point", "postgres")).toBeNull();
  });
  it("skips types the search cannot apply LOWER/LIKE to", () => {
    expect(columnKind("text[]", "postgres")).toBeNull();
    expect(columnKind("TEXT", "informix")).toBeNull(); // Informix blob
    expect(columnKind("ntext", "mssql")).toBeNull();
    expect(columnKind("bytea", "postgres")).toBeNull();
    expect(columnKind("", "sqlite")).toBeNull();
  });
});

describe("likePattern", () => {
  it("escapes %, _ and the escape character", () => {
    expect(likePattern("50%_off!", "contains", "postgres")).toBe("%50!%!_off!!%");
    expect(likePattern("ab", "startsWith", "sqlite")).toBe("ab%");
  });
  it("escapes [ only on SQL Server, where LIKE reads it as a class", () => {
    expect(likePattern("[x]", "contains", "mssql")).toBe("%![x]%");
    expect(likePattern("[x]", "contains", "mysql")).toBe("%[x]%");
  });
});

describe("planTable", () => {
  it("sqlite: LOWER on both sides, LIMIT, quoted identifiers", () => {
    expect(sqlOf("sqlite").sql).toBe(
      `SELECT * FROM "ventas"."clientes" WHERE LOWER("nombre") LIKE LOWER('%ana%') ESCAPE '!' LIMIT 50;`,
    );
  });
  it("postgres: ILIKE", () => {
    expect(sqlOf("postgres").sql).toBe(
      `SELECT * FROM "ventas"."clientes" WHERE "nombre" ILIKE '%ana%' ESCAPE '!' LIMIT 50;`,
    );
  });
  it("mysql: backticks, backslash doubled in the literal", () => {
    expect(sqlOf("mysql", { text: "a\\b" }).sql).toBe(
      "SELECT * FROM `ventas`.`clientes` WHERE LOWER(`nombre`) LIKE LOWER('%a\\\\b%') ESCAPE '!' LIMIT 50;",
    );
  });
  it("mssql: brackets, N'' literal and OFFSET/FETCH", () => {
    expect(sqlOf("mssql").sql).toBe(
      "SELECT * FROM [ventas].[clientes] WHERE LOWER([nombre]) LIKE LOWER(N'%ana%') ESCAPE '!' ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;",
    );
  });
  it("informix: db:table, FIRST n, client-lowered pattern", () => {
    expect(sqlOf("informix", { text: "ANA" }, { nombre: "VARCHAR" }).sql).toBe(
      "SELECT FIRST 50 * FROM ventas:clientes WHERE LOWER(nombre) LIKE '%ana%' ESCAPE '!';",
    );
  });
  it("escapes quotes in the text and in identifiers", () => {
    const p = planTable({ name: 'my"t' }, { 'co"l': "text" }, "postgres", opts({ text: "O'Brien" }));
    expect("sql" in p && p.sql).toBe(
      `SELECT * FROM "my""t" WHERE "co""l" ILIKE '%O''Brien%' ESCAPE '!' LIMIT 50;`,
    );
    const m = planTable({ name: "t]x" }, { "c]": "varchar" }, "mssql", opts({ text: "a'b" }));
    expect("sql" in m && m.sql).toContain("[t]]x]");
    expect("sql" in m && m.sql).toContain("LOWER([c]]]) LIKE LOWER(N'%a''b%')");
  });
  it("exact and starts-with modes", () => {
    expect(sqlOf("postgres", { mode: "exact" }).sql).toContain(`LOWER("nombre") = LOWER('ana')`);
    expect(sqlOf("postgres", { mode: "exact", ignoreCase: false }).sql).toContain(`"nombre" = 'ana'`);
    expect(sqlOf("sqlite", { mode: "startsWith", ignoreCase: false }).sql).toContain(
      `"nombre" LIKE 'ana%' ESCAPE '!'`,
    );
  });
  it("adds numeric columns by exact value only when asked and the text is a number", () => {
    expect(sqlOf("sqlite", { text: "42", numeric: true }).sql).toContain(`"id" = 42 OR LOWER("nombre")`);
    expect(sqlOf("sqlite", { text: "42" }).sql).not.toContain(`"id"`);
    expect(sqlOf("sqlite", { text: "4x", numeric: true }).sql).not.toContain(`"id"`);
  });
  it("skips a table with no searchable column, with a reason", () => {
    expect(planTable({ name: "t" }, { id: "integer", b: "blob" }, "sqlite", opts())).toEqual({
      skipped: "ds.skipNoColumns",
    });
  });
  it("clamps the limit and gives an uncapped query to open the matches", () => {
    const p = sqlOf("sqlite", { limit: 0 });
    expect(p.sql).toMatch(/LIMIT 1;$/);
    expect(p.openSql).toBe(`SELECT * FROM "ventas"."clientes" WHERE LOWER("nombre") LIKE LOWER('%ana%') ESCAPE '!';`);
    expect(sqlOf("informix", {}, { nombre: "CHAR" }).openSql).toMatch(/^SELECT \* FROM ventas:clientes WHERE/);
    expect(p.columns).toEqual(["nombre"]);
  });
});

describe("matchLabel", () => {
  it("says ≥ when the cap was hit", () => {
    expect(matchLabel({ count: 50, capped: true })).toBe("≥ 50");
    expect(matchLabel({ count: 3, capped: false })).toBe("3");
  });
});

const rowsOf = (n: number) => ({ columns: [{ name: "s", type: "text" }], rows: Array.from({ length: n }, () => ["x"]) });

describe("runSearch", () => {
  const tables = [{ name: "a" }, { name: "b" }, { name: "c" }];
  const describeAll = async (t: { name: string }): Promise<Record<string, string>> =>
    t.name === "b" ? { id: "integer" } : { s: "text" };

  it("runs table by table, skips, caps and reports progress", async () => {
    const progress: string[] = [];
    const out = await runSearch(
      tables,
      "sqlite",
      opts({ limit: 2 }),
      { describe: describeAll, run: async (sql) => rowsOf(sql.includes('"a"') ? 2 : 1) },
      () => false,
      (i, n, t) => progress.push(`${i}/${n} ${t}`),
    );
    expect(progress).toEqual(["1/3 a", "2/3 b", "3/3 c"]);
    expect(out.stopped).toBe(false);
    expect(out.results.map((r) => [r.table, r.count, r.capped, r.skipped])).toEqual([
      ["a", 2, true, undefined],
      ["b", 0, false, "ds.skipNoColumns"],
      ["c", 1, false, undefined],
    ]);
  });

  it("stops between tables when cancelled", async () => {
    let stop = false;
    const out = await runSearch(
      tables,
      "sqlite",
      opts(),
      { describe: describeAll, run: async () => ((stop = true), rowsOf(0)) },
      () => stop,
    );
    expect(out.stopped).toBe(true);
    expect(out.results.map((r) => r.table)).toEqual(["a"]);
  });

  it("records a failing table and goes on", async () => {
    const out = await runSearch(
      [{ name: "a" }, { name: "c" }],
      "sqlite",
      opts(),
      {
        describe: describeAll,
        run: async (sql) => {
          if (sql.includes('"a"')) throw new Error("boom");
          return rowsOf(0);
        },
      },
      () => false,
    );
    expect(out.results[0].error).toContain("boom");
    expect(out.results[1]).toMatchObject({ table: "c", count: 0 });
  });

  it("treats the cancelled query's error as a stop, not a failure", async () => {
    let stop = false;
    const out = await runSearch(
      tables,
      "sqlite",
      opts(),
      {
        describe: describeAll,
        run: async () => {
          stop = true;
          throw new Error("canceled");
        },
      },
      () => stop,
    );
    expect(out).toEqual({ results: [], stopped: true });
  });
});

import { foldAccents, foldAccentsSql, searchableCounts, planTable as plan2 } from "../../src/utils/dataSearch";

describe("accent folding", () => {
  it("folds the common accented vowels of the text, both cases, and leaves ñ", () => {
    expect(foldAccents("Ángel Muñoz Güell")).toBe("Angel Muñoz Guell");
  });
  it("wraps the column in REPLACE, lower-case only when the server lowered it", () => {
    const lowered = foldAccentsSql("LOWER(x)", true, "postgres");
    expect(lowered.startsWith("REPLACE(REPLACE(")).toBe(true);
    expect(lowered).toContain("'á', 'a'");
    expect(lowered).not.toContain("'Á'");
    // SQLite's LOWER leaves Á alone: both cases are folded there.
    expect(foldAccentsSql("LOWER(x)", true, "sqlite")).toContain("'Á', 'A'");
    expect(foldAccentsSql("x", false, "mysql")).toContain("'Á', 'A'");
  });
  it("searches folded on both sides when asked", () => {
    const p = plan2({ name: "t" }, { s: "text" }, "postgres", {
      text: "Ángel",
      mode: "contains",
      ignoreCase: true,
      ignoreAccents: true,
      numeric: false,
      limit: 10,
    });
    expect("sql" in p && p.sql).toContain("LIKE '%angel%' ESCAPE '!'");
    expect("sql" in p && p.sql).toContain("REPLACE(LOWER(\"s\"), 'á', 'a')");
  });
});

describe("searchableCounts", () => {
  it("counts text and number columns, ignoring the rest", () => {
    expect(searchableCounts({ a: "varchar(10)", b: "int", c: "blob", d: "text" }, "mysql")).toEqual({ text: 2, number: 1 });
  });
});

describe("runSearch live results", () => {
  it("reports each table as it finishes and keeps the rows it read", async () => {
    const seen: string[] = [];
    const out = await runSearch(
      [{ name: "a" }, { name: "b" }],
      "sqlite",
      { text: "x", mode: "contains", ignoreCase: true, numeric: false, limit: 5 },
      {
        describe: async (t): Promise<Record<string, string>> => (t.name === "b" ? { id: "integer" } : { s: "text" }),
        run: async () => ({ columns: [{ name: "s", type: "text" }], rows: [["x"]] }),
      },
      () => false,
      undefined,
      (r) => seen.push(r.table),
    );
    expect(seen).toEqual(["a", "b"]);
    expect(out.results[0].matches!.rows).toEqual([["x"]]);
    expect(out.results[0].columns).toEqual(["s"]);
    expect(out.results[1].skipped).toBe("ds.skipNoColumns");
  });
});
