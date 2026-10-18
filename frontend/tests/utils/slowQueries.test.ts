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

  it("supports MongoDB via the profiler, without a one-statement reset", () => {
    const s = slowQuerySupport("mongodb");
    expect(s.supported).toBe(true);
    expect(s.queryColumn).toBe("query");
    expect(s.resetSql).toBeNull();
    expect(s.emptyHint).toBe("slow.emptyMongo");
    expect(s.statementOf).not.toBeNull();
  });

  it("MongoDB: the statement of a row is rebuilt from its namespace and command", () => {
    const s = slowQuerySupport("mongodb");
    expect(
      s.statementOf!({ ns: "shop.orders", query: JSON.stringify({ find: "orders", filter: { a: 1 } }) }),
    ).toBe('db.orders.find({"a":1})');
    expect(s.statementOf!({ ns: "shop.orders", query: JSON.stringify({ insert: "orders" }) })).toBeNull();
    expect(s.statementOf!({ ns: null, query: "{}" })).toBeNull();
    expect(s.statementOf!({ ns: "shop.orders", query: null })).toBeNull();
  });

  it("is honestly unsupported for sqlite/informix", () => {
    for (const e of ["sqlite", "informix"]) {
      const s = slowQuerySupport(e);
      expect(s.supported).toBe(false);
      expect(s.queryColumn).toBeNull();
      expect(s.reason).toBeTruthy();
      expect(s.statementOf).toBeNull();
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

  const mongoPipeline = (sql: string) =>
    JSON.parse(sql.slice("db.system.profile.aggregate(".length, -1)) as Record<string, any>[];

  it("MongoDB groups the profile by collection, operation and shape, ordered as asked", () => {
    const cols = { avg: "avg_ms", total: "total_ms", count: "ejecuciones" } as const;
    for (const order of ["avg", "total", "count"] as const) {
      const sql = buildSlowQuerySql("mongodb", order)!;
      expect(sql.startsWith("db.system.profile.aggregate(")).toBe(true);
      const pipeline = mongoPipeline(sql);
      const sorts = pipeline.filter((s) => "$sort" in s);
      expect(sorts[1].$sort).toEqual({ [cols[order]]: -1 });
      expect(pipeline.find((s) => "$limit" in s)!.$limit).toBe(DEFAULT_SLOW_LIMIT);
      expect(pipeline.find((s) => "$group" in s)!.$group._id).toEqual({
        ns: "$ns",
        op: "$op",
        qh: "$queryHash",
      });
    }
  });

  it("MongoDB leaves system collections out and clamps the limit", () => {
    const pipeline = mongoPipeline(buildSlowQuerySql("mongodb", "avg", 99999)!);
    expect(pipeline[0].$match.ns.$not.$regex).toBe("\\.system\\.");
    expect(pipeline.find((s) => "$limit" in s)!.$limit).toBe(1000);
  });

  it("MongoDB projects the columns the grid and the statement rebuild read", () => {
    const pipeline = mongoPipeline(buildSlowQuerySql("mongodb", "avg")!);
    const project = pipeline[pipeline.length - 1].$project;
    expect(Object.keys(project)).toEqual(
      expect.arrayContaining(["ns", "op", "query", "ejecuciones", "avg_ms", "total_ms", "max_ms"]),
    );
    expect(project._id).toBe(0);
  });

  it("returns null for unsupported engines", () => {
    expect(buildSlowQuerySql("sqlite", "avg")).toBeNull();
    expect(buildSlowQuerySql("informix", "total")).toBeNull();
  });
});

describe("unsupportedReason", () => {
  it("names the engine when unknown", () => {
    expect(unsupportedReason("weird")).toContain("weird");
  });
});
