import { describe, it, expect } from "vitest";
import {
  monitorFor,
  buildKillSql,
  unsupportedReason,
} from "../../src/utils/serverMonitor";

describe("monitorFor", () => {
  it("supports MySQL/MariaDB with SHOW PROCESSLIST + kill", () => {
    for (const e of ["mysql", "mariadb", "MySQL"]) {
      const m = monitorFor(e);
      expect(m.supported).toBe(true);
      expect(m.listSql).toContain("PROCESSLIST");
      expect(m.idColumn).toBe("Id");
      expect(m.canKill).toBe(true);
    }
  });

  it("supports PostgreSQL via pg_stat_activity + terminate", () => {
    const m = monitorFor("postgres");
    expect(m.supported).toBe(true);
    expect(m.listSql).toContain("pg_stat_activity");
    expect(m.idColumn).toBe("pid");
    expect(m.canKill).toBe(true);
  });

  it("is unsupported for sqlite / informix / mongodb / unknown", () => {
    for (const e of ["sqlite", "informix", "mongodb", "weirddb"]) {
      const m = monitorFor(e);
      expect(m.supported).toBe(false);
      expect(m.listSql).toBeNull();
      expect(m.canKill).toBe(false);
    }
  });
});

describe("buildKillSql", () => {
  it("builds the engine's kill statement for a numeric id", () => {
    expect(buildKillSql("mysql", "42")).toBe("KILL 42");
    expect(buildKillSql("mariadb", " 7 ")).toBe("KILL 7");
    expect(buildKillSql("postgres", "1234")).toBe("SELECT pg_terminate_backend(1234)");
  });

  it("refuses a non-numeric id (injection guard)", () => {
    expect(buildKillSql("mysql", "1; DROP TABLE t")).toBeNull();
    expect(buildKillSql("mysql", "abc")).toBeNull();
    expect(buildKillSql("mysql", "")).toBeNull();
  });

  it("returns null for engines that cannot kill via SQL", () => {
    expect(buildKillSql("sqlite", "1")).toBeNull();
    expect(buildKillSql("informix", "1")).toBeNull();
    expect(buildKillSql("mongodb", "1")).toBeNull();
  });
});

describe("unsupportedReason", () => {
  it("explains why per engine", () => {
    expect(unsupportedReason("sqlite")).toContain("embebida");
    expect(unsupportedReason("informix")).toContain("onmode");
    expect(unsupportedReason("mongodb")).toContain("MongoDB");
    expect(unsupportedReason("")).toContain("desconocido");
  });
});
