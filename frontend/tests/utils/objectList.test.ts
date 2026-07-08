import { describe, it, expect } from "vitest";
import { objectListFor, formatBytes } from "../../src/utils/objectList";

describe("objectListFor", () => {
  it("MySQL: information_schema.TABLES scoped to the db, full metadata", () => {
    const r = objectListFor("mysql", "ventas");
    expect(r.supported).toBe(true);
    expect(r.sql).toContain("information_schema.TABLES");
    expect(r.sql).toContain("TABLE_SCHEMA = 'ventas'");
    expect(r.columns.map((c) => c.key)).toEqual(["nombre", "tipo", "filas", "tamano", "comentario"]);
  });

  it("escapes the db name against injection", () => {
    const r = objectListFor("mysql", "a' OR '1'='1");
    expect(r.sql).toContain("'a'' OR ''1''=''1'");
  });

  it("Informix: systables, row estimate only (no size/comment column)", () => {
    const r = objectListFor("informix", "ignored");
    expect(r.supported).toBe(true);
    expect(r.sql).toContain("FROM systables");
    expect(r.sql).toContain("tabid > 99");
    expect(r.columns.map((c) => c.key)).toEqual(["nombre", "tipo", "filas"]);
  });

  it("SQLite: sqlite_master, name+type, skips internal objects", () => {
    const r = objectListFor("sqlite", "main");
    expect(r.sql).toContain("FROM sqlite_master");
    expect(r.sql).toContain("name NOT LIKE 'sqlite_%'");
    expect(r.columns.map((c) => c.key)).toEqual(["nombre", "tipo"]);
  });

  it("PostgreSQL: pg_class metadata (SQL ready even though driver ships later)", () => {
    const r = objectListFor("postgres", "public");
    expect(r.supported).toBe(true);
    expect(r.sql).toContain("pg_class");
    expect(r.sql).toContain("n.nspname = 'public'");
  });

  it("MongoDB: honest unsupported with a reason, no SQL", () => {
    const r = objectListFor("mongodb", "x");
    expect(r.supported).toBe(false);
    expect(r.sql).toBeNull();
    expect(r.reason).toMatch(/colecciones/i);
  });

  it("unknown engine: unsupported", () => {
    expect(objectListFor("oracle", "x").supported).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats byte magnitudes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(42 * 1024 * 1024)).toBe("42 MB");
    expect(formatBytes("18700000")).toBe("18 MB");
  });
  it("passes through empty/invalid honestly", () => {
    expect(formatBytes(null)).toBe("");
    expect(formatBytes("")).toBe("");
  });
});
