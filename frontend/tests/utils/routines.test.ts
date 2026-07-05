import { describe, it, expect } from "vitest";
import {
  routinesFor,
  definitionFor,
  unsupportedReason,
} from "../../src/utils/routines";

describe("routinesFor", () => {
  it("lists MySQL/MariaDB routines from information_schema scoped to DATABASE()", () => {
    for (const e of ["mysql", "mariadb", "MySQL"]) {
      const r = routinesFor(e);
      expect(r.supported).toBe(true);
      expect(r.listSql).toContain("information_schema.ROUTINES");
      expect(r.listSql).toContain("DATABASE()");
      expect(r.nameCol).toBe("ROUTINE_NAME");
      expect(r.typeCol).toBe("ROUTINE_TYPE");
    }
  });

  it("scopes MySQL listing to a given database (escaping quotes)", () => {
    const r = routinesFor("mysql", "my'db");
    expect(r.listSql).toContain("ROUTINE_SCHEMA = 'my''db'");
    expect(r.listSql).not.toContain("DATABASE()");
  });

  it("lists PostgreSQL routines from pg_proc excluding system schemas", () => {
    const r = routinesFor("postgres");
    expect(r.supported).toBe(true);
    expect(r.listSql).toContain("pg_proc");
    expect(r.listSql).toContain("pg_catalog");
    expect(r.schemaCol).toBe("schema");
    expect(r.nameCol).toBe("name");
  });

  it("lists Informix routines from sysprocedures carrying procid for overloads", () => {
    const r = routinesFor("informix");
    expect(r.supported).toBe(true);
    expect(r.listSql).toContain("sysprocedures");
    expect(r.listSql).toContain("procid");
    expect(r.schemaCol).toBeNull();
    expect(r.idCol).toBe("procid");
  });

  it("is unsupported for sqlite / mongodb / unknown", () => {
    for (const e of ["sqlite", "mongodb", "weirddb"]) {
      const r = routinesFor(e);
      expect(r.supported).toBe(false);
      expect(r.listSql).toBeNull();
    }
  });
});

describe("definitionFor", () => {
  it("builds SHOW CREATE PROCEDURE/FUNCTION for MySQL with backtick-quoted name", () => {
    const p = definitionFor("mysql", { name: "do_thing", type: "PROCEDURE" });
    expect(p).toEqual({
      sql: "SHOW CREATE PROCEDURE `do_thing`",
      column: "Create Procedure",
      concatRows: false,
    });
    const f = definitionFor("mariadb", { name: "calc`x", type: "FUNCTION" });
    expect(f!.sql).toBe("SHOW CREATE FUNCTION `calc``x`");
    expect(f!.column).toBe("Create Function");
  });

  it("builds pg_get_functiondef for PostgreSQL with schema default public", () => {
    const d = definitionFor("postgres", { name: "f", type: "FUNCTION" });
    expect(d!.sql).toContain("pg_get_functiondef");
    expect(d!.sql).toContain("n.nspname = 'public'");
    expect(d!.sql).toContain("p.proname = 'f'");
    expect(d!.column).toBe("definition");
    const d2 = definitionFor("postgres", { name: "f", type: "FUNCTION", schema: "app" });
    expect(d2!.sql).toContain("n.nspname = 'app'");
  });

  it("reassembles Informix definition pinned to procid when known (overloads)", () => {
    const d = definitionFor("informix", { name: "myproc", type: "PROCEDURE", id: "42" });
    expect(d!.sql).toContain("sysprocbody");
    expect(d!.sql).toContain("b.procid = 42");
    expect(d!.sql).not.toContain("FIRST 1");
    expect(d!.sql).toContain("datakey = 'T'");
    expect(d!.sql).toContain("ORDER BY b.seqno");
    expect(d!.column).toBe("data");
    expect(d!.concatRows).toBe(true);
  });

  it("falls back to FIRST 1 procid by name when no id is available", () => {
    const d = definitionFor("informix", { name: "myproc", type: "PROCEDURE" });
    expect(d!.sql).toContain("SELECT FIRST 1 p.procid");
    expect(d!.sql).toContain("p.procname = 'myproc'");
  });

  it("ignores a non-numeric Informix id (injection guard) and falls back by name", () => {
    const d = definitionFor("informix", { name: "p", type: "PROCEDURE", id: "1; DROP" });
    expect(d!.sql).toContain("SELECT FIRST 1 p.procid");
    expect(d!.sql).not.toContain("DROP");
  });

  it("returns null for unsupported engines or empty name", () => {
    expect(definitionFor("sqlite", { name: "x", type: "PROCEDURE" })).toBeNull();
    expect(definitionFor("mongodb", { name: "x", type: "FUNCTION" })).toBeNull();
    expect(definitionFor("mysql", { name: "  ", type: "PROCEDURE" })).toBeNull();
  });
});

describe("unsupportedReason", () => {
  it("explains why per engine", () => {
    expect(unsupportedReason("sqlite")).toContain("embebida");
    expect(unsupportedReason("mongodb")).toContain("MongoDB");
    expect(unsupportedReason("")).toContain("desconocido");
  });
});
