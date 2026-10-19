import { describe, it, expect } from "vitest";
import {
  monitorFor,
  buildKillSql,
  unsupportedReason,
  sessionFacts,
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

  it("supports MongoDB via db.currentOp() + killOp on the opid column", () => {
    const m = monitorFor("mongodb");
    expect(m.supported).toBe(true);
    expect(m.listSql).toBe("db.currentOp()");
    expect(m.idColumn).toBe("opid");
    expect(m.canKill).toBe(true);
  });

  it("is unsupported for sqlite / informix / unknown", () => {
    for (const e of ["sqlite", "informix", "weirddb"]) {
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
  });

  it("MongoDB: killOp with the integer opid, or the string id of a sharded cluster", () => {
    expect(buildKillSql("mongodb", "12345")).toBe("db.killOp(12345)");
    expect(buildKillSql("mongodb", " 7 ")).toBe("db.killOp(7)");
    expect(buildKillSql("mongodb", "shard01:99")).toBe('db.killOp("shard01:99")');
  });

  it("MongoDB: refuses anything that is not an operation id (injection guard)", () => {
    for (const bad of ["", "abc", "1); db.dropDatabase(", '1"); x("', "-1", "1.5", "a:b", "shard:1;x"]) {
      expect(buildKillSql("mongodb", bad)).toBeNull();
    }
  });
});

describe("unsupportedReason", () => {
  it("explains why per engine", () => {
    expect(unsupportedReason("sqlite")).toContain("embebida");
    expect(unsupportedReason("informix")).toContain("onmode");
    expect(unsupportedReason("mongodb")).toContain("mongodb");
    expect(unsupportedReason("")).toContain("desconocido");
  });
});

describe("sessionFacts", () => {
  it("keeps the columns with a value, in order, one line each", () => {
    const facts = sessionFacts(
      [{ name: "Id" }, { name: "User" }, { name: "Info" }, { name: "db" }],
      ["7", "root", "SELECT *\n  FROM big", null],
    );
    expect(facts).toEqual([
      { name: "Id", value: "7" },
      { name: "User", value: "root" },
      { name: "Info", value: "SELECT * FROM big" },
    ]);
  });

  it("cuts a long query and skips blanks", () => {
    const [q] = sessionFacts([{ name: "q" }, { name: "e" }], ["x".repeat(300), "  "]);
    expect(q.value).toHaveLength(161);
    expect(q.value.endsWith("…")).toBe(true);
  });
});

import {
  sessionState,
  sessionQuery,
  monitorKpis,
  viewSessions,
  nextSessionSort,
  shouldAutoRefresh,
  buildCancelSql,
} from "../../src/utils/serverMonitor";

const pgCols = [
  { name: "pid", type: "int" },
  { name: "user", type: "text" },
  { name: "state", type: "text" },
  { name: "wait_event_type", type: "text" },
  { name: "query", type: "text" },
];
const pgRows: (string | null)[][] = [
  ["30", "app", "active", null, "SELECT 1"],
  ["4", "reportes", "idle in transaction", "Client", "UPDATE pedidos SET x = 1"],
  ["12", "app", "idle", "Client", "SELECT now()"],
  ["9", "etl", "active", "Lock", "DELETE FROM t"],
];
const pg = { columns: pgCols, rows: pgRows, truncated: false, rowsAffected: 0 };

describe("sessionState", () => {
  it("reads PostgreSQL state and lock waits", () => {
    expect(pgRows.map((r) => sessionState("postgres", pgCols, r))).toEqual(["active", "idleInTx", "idle", "waiting"]);
  });

  it("reads MySQL Command and State", () => {
    const cols = [{ name: "Id" }, { name: "Command" }, { name: "State" }];
    expect(sessionState("mysql", cols, ["1", "Sleep", ""])).toBe("idle");
    expect(sessionState("mysql", cols, ["2", "Query", "Sending data"])).toBe("active");
    expect(sessionState("mariadb", cols, ["3", "Query", "Waiting for table metadata lock"])).toBe("waiting");
  });

  it("reads MongoDB currentOp flags", () => {
    const cols = [{ name: "opid" }, { name: "active" }, { name: "waitingForLock" }];
    expect(sessionState("mongodb", cols, ["1", "true", "false"])).toBe("active");
    expect(sessionState("mongodb", cols, ["1", "false", "false"])).toBe("idle");
    expect(sessionState("mongodb", cols, ["1", "true", "true"])).toBe("waiting");
  });

  it("is null when the row does not say, or the engine has no monitor", () => {
    expect(sessionState("postgres", [{ name: "pid" }], ["1"])).toBeNull();
    expect(sessionState("sqlite", pgCols, pgRows[0])).toBeNull();
  });
});

describe("sessionQuery", () => {
  it("finds the query column under each engine's name", () => {
    expect(sessionQuery(pgCols, pgRows[0])).toBe("SELECT 1");
    expect(sessionQuery([{ name: "Info" }], ["SHOW TABLES"])).toBe("SHOW TABLES");
    expect(sessionQuery([{ name: "Info" }], [null])).toBeNull();
    expect(sessionQuery([{ name: "x" }], ["y"])).toBeNull();
    expect(sessionQuery([{ name: "Command" }, { name: "Info" }], ["Query", "SELECT 2"])).toBe("SELECT 2");
  });
});

describe("monitorKpis", () => {
  it("counts each state from the list", () => {
    expect(monitorKpis("postgres", pg)).toEqual({ total: 4, active: 1, idle: 2, waiting: 1 });
  });
  it("is all zero without a result", () => {
    expect(monitorKpis("postgres", null)).toEqual({ total: 0, active: 0, idle: 0, waiting: 0 });
  });
});

describe("viewSessions", () => {
  const ids = (r: { rows: (string | null)[][] } | null) => r!.rows.map((x) => x[0]);
  it("filters by text in any cell, case-insensitively", () => {
    expect(ids(viewSessions("postgres", pg, { text: "UPDATE", hideIdle: false, sort: null }))).toEqual(["4"]);
    expect(ids(viewSessions("postgres", pg, { text: "  app ", hideIdle: false, sort: null }))).toEqual(["30", "12"]);
  });
  it("hides idle sessions but keeps idle-in-transaction ones", () => {
    expect(ids(viewSessions("postgres", pg, { text: "", hideIdle: true, sort: null }))).toEqual(["30", "4", "9"]);
  });
  it("sorts by a column, numerically for numbers", () => {
    expect(ids(viewSessions("postgres", pg, { text: "", hideIdle: false, sort: { column: "pid", dir: "ASC" } }))).toEqual(["4", "9", "12", "30"]);
    expect(ids(viewSessions("postgres", pg, { text: "", hideIdle: false, sort: { column: "pid", dir: "DESC" } }))).toEqual(["30", "12", "9", "4"]);
  });
  it("is null without a result", () => {
    expect(viewSessions("postgres", null, { text: "", hideIdle: false, sort: null })).toBeNull();
  });
});

describe("nextSessionSort", () => {
  it("cycles ascending, descending, none; another column starts ascending", () => {
    const a = nextSessionSort(null, "pid");
    expect(a).toEqual({ column: "pid", dir: "ASC" });
    expect(nextSessionSort(a, "pid")).toEqual({ column: "pid", dir: "DESC" });
    expect(nextSessionSort({ column: "pid", dir: "DESC" }, "pid")).toBeNull();
    expect(nextSessionSort(a, "user")).toEqual({ column: "user", dir: "ASC" });
  });
});

describe("shouldAutoRefresh", () => {
  const base = { auto: true, loading: false, asking: false, hidden: false };
  it("refreshes only when on, idle, not asking and visible", () => {
    expect(shouldAutoRefresh(base)).toBe(true);
    expect(shouldAutoRefresh({ ...base, auto: false })).toBe(false);
    expect(shouldAutoRefresh({ ...base, loading: true })).toBe(false);
    expect(shouldAutoRefresh({ ...base, asking: true })).toBe(false);
    expect(shouldAutoRefresh({ ...base, hidden: true })).toBe(false);
  });
});

describe("buildCancelSql", () => {
  it("cancels the query and keeps the session", () => {
    expect(buildCancelSql("postgres", "4127")).toBe("SELECT pg_cancel_backend(4127)");
    expect(buildCancelSql("mysql", " 7 ")).toBe("KILL QUERY 7");
  });
  it("refuses non-numeric ids and engines without it", () => {
    expect(buildCancelSql("postgres", "1; DROP")).toBeNull();
    expect(buildCancelSql("mongodb", "1")).toBeNull();
    expect(buildCancelSql("sqlite", "1")).toBeNull();
  });
});
