import { describe, it, expect } from "vitest";
import {
  slowQuerySupport,
  buildSlowQuerySql,
  unsupportedReason,
  DEFAULT_SLOW_LIMIT,
} from "../../src/utils/slowQueries";

describe("slowQuerySupport", () => {
  it("supports MySQL/MariaDB with a reset and query column", () => {
    for (const e of ["mysql", "mariadb", "MariaDB"]) {
      const s = slowQuerySupport(e);
      expect(s.supported).toBe(true);
      expect(s.queryColumn).toBe("query");
      expect(s.resetSql).toContain("events_statements_summary_by_digest");
      expect(s.reason).toBeNull();
    }
  });

  it("supports PostgreSQL via pg_stat_statements", () => {
    const s = slowQuerySupport("postgres");
    expect(s.supported).toBe(true);
    expect(s.resetSql).toBe("SELECT pg_stat_statements_reset()");
  });

  it("is honestly unsupported for sqlite/informix/mongodb", () => {
    for (const e of ["sqlite", "informix", "mongodb"]) {
      const s = slowQuerySupport(e);
      expect(s.supported).toBe(false);
      expect(s.queryColumn).toBeNull();
      expect(s.reason).toBeTruthy();
    }
  });
});

describe("buildSlowQuerySql", () => {
  it("orders MySQL by the right timer/count column", () => {
    expect(buildSlowQuerySql("mysql", "avg")).toContain("ORDER BY AVG_TIMER_WAIT DESC");
    expect(buildSlowQuerySql("mysql", "total")).toContain("ORDER BY SUM_TIMER_WAIT DESC");
    expect(buildSlowQuerySql("mysql", "count")).toContain("ORDER BY COUNT_STAR DESC");
    expect(buildSlowQuerySql("mysql", "avg")).toContain("performance_schema.events_statements_summary_by_digest");
  });

  it("orders PostgreSQL by the right column", () => {
    expect(buildSlowQuerySql("postgres", "avg")).toContain("ORDER BY mean_exec_time DESC");
    expect(buildSlowQuerySql("postgres", "total")).toContain("ORDER BY total_exec_time DESC");
    expect(buildSlowQuerySql("postgres", "count")).toContain("ORDER BY calls DESC");
    expect(buildSlowQuerySql("postgres", "avg")).toContain("FROM pg_stat_statements");
  });

  it("applies and clamps the limit", () => {
    expect(buildSlowQuerySql("mysql", "avg")).toContain(`LIMIT ${DEFAULT_SLOW_LIMIT}`);
    expect(buildSlowQuerySql("mysql", "avg", 10)).toContain("LIMIT 10");
    expect(buildSlowQuerySql("mysql", "avg", 0)).toContain("LIMIT 1"); // clamped up
    expect(buildSlowQuerySql("mysql", "avg", 99999)).toContain("LIMIT 1000"); // clamped down
    expect(buildSlowQuerySql("postgres", "avg", NaN)).toContain(`LIMIT ${DEFAULT_SLOW_LIMIT}`);
  });

  it("returns null for unsupported engines", () => {
    expect(buildSlowQuerySql("sqlite", "avg")).toBeNull();
    expect(buildSlowQuerySql("mongodb", "total")).toBeNull();
  });
});

describe("unsupportedReason", () => {
  it("names the engine when unknown", () => {
    expect(unsupportedReason("weird")).toContain("weird");
  });
});
