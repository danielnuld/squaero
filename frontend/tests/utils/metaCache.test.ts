import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CACHE_CAP,
  STALE_AFTER_MS,
  STORAGE_KEY,
  clearConn,
  colsKey,
  connFingerprint,
  createMetaCacheStore,
  ddlTargets,
  getEntry,
  invalidateForSql,
  isStale,
  listEntries,
  markStale,
  openConn,
  parseCache,
  putEntry,
  serializeCache,
  touch,
  treeKey,
  type MetaCache,
} from "../../src/utils/metaCache";
import type { KeyValueStore } from "../../src/utils/kvStore";

const T0 = 1_700_000_000_000;

// A cache with connection "a" opened and the given entries put at T0.
function withEntries(entries: Record<string, unknown>, id = "a"): MetaCache {
  let c = openConn({}, id, "fp");
  for (const [k, v] of Object.entries(entries)) c = putEntry(c, id, k, v, T0).cache;
  return c;
}

describe("connFingerprint", () => {
  const pg = { driver: "postgres", params: { host: "h1", port: "5432", database: "d", user: "u", password: "p1" } };

  it("is stable for the same non-secret params, in any key order", () => {
    const reordered = { driver: "postgres", params: { user: "u", database: "d", port: "5432", host: "h1", password: "p1" } };
    expect(connFingerprint(pg)).toBe(connFingerprint(reordered));
  });

  it("changes when the host, database or driver changes", () => {
    const fp = connFingerprint(pg);
    expect(connFingerprint({ ...pg, params: { ...pg.params, host: "h2" } })).not.toBe(fp);
    expect(connFingerprint({ ...pg, params: { ...pg.params, database: "other" } })).not.toBe(fp);
    expect(connFingerprint({ ...pg, driver: "mysql" })).not.toBe(fp);
  });

  it("ignores secrets: a new password keeps the cache", () => {
    const fp = connFingerprint(pg);
    expect(connFingerprint({ ...pg, params: { ...pg.params, password: "p2" } })).toBe(fp);
    expect(connFingerprint({ ...pg, params: { ...pg.params, ssh_password: "x" } })).toBe(fp);
    // Unknown driver: secret-looking keys are still left out.
    const odd = { driver: "nope", params: { host: "h" } };
    expect(connFingerprint({ ...odd, params: { host: "h", api_token: "t" } })).toBe(connFingerprint(odd));
  });

  it("does not spell out the params", () => {
    expect(connFingerprint(pg)).not.toContain("h1");
  });
});

describe("put / get", () => {
  it("returns what was put, with its fetch time", () => {
    const c = withEntries({ [treeKey("")]: [{ name: "main", kind: "database" }] });
    expect(getEntry(c, "a", treeKey(""), T0 + 1000)).toEqual({
      value: [{ name: "main", kind: "database" }],
      fetchedAt: T0,
      stale: false,
    });
  });

  it("misses an unknown key or connection", () => {
    const c = withEntries({ k: 1 });
    expect(getEntry(c, "a", "other", T0)).toBeUndefined();
    expect(getEntry(c, "b", "k", T0)).toBeUndefined();
  });

  it("does not store for a connection never opened", () => {
    const r = putEntry({}, "a", "k", 1, T0);
    expect(r.ok).toBe(false);
    expect(r.cache).toEqual({});
  });

  it("a put replaces the value and clears a stale mark", () => {
    let c = markStale(withEntries({ k: 1 }), "a");
    expect(getEntry(c, "a", "k", T0)!.stale).toBe(true);
    c = putEntry(c, "a", "k", 2, T0 + 5).cache;
    expect(getEntry(c, "a", "k", T0 + 5)).toEqual({ value: 2, fetchedAt: T0 + 5, stale: false });
  });

  it("lists entries by key prefix", () => {
    const c = withEntries({ [colsKey("users")]: ["id"], [colsKey("orders")]: ["id"], [treeKey("")]: [] });
    expect(listEntries(c, "a", "cols:", T0).map((x) => x.key).sort()).toEqual(["cols:orders", "cols:users"]);
    expect(listEntries(c, "zz", "cols:", T0)).toEqual([]);
  });
});

describe("staleness", () => {
  it("by age: fresh until STALE_AFTER_MS has passed", () => {
    expect(isStale({ fetchedAt: T0, stale: false }, T0 + STALE_AFTER_MS)).toBe(false);
    expect(isStale({ fetchedAt: T0, stale: false }, T0 + STALE_AFTER_MS + 1)).toBe(true);
    const c = withEntries({ k: 1 });
    expect(getEntry(c, "a", "k", T0 + STALE_AFTER_MS + 1)!.stale).toBe(true);
  });

  it("by explicit invalidation, whatever the age", () => {
    expect(isStale({ fetchedAt: T0, stale: true }, T0)).toBe(true);
  });

  it("markStale with a predicate touches only the matching keys", () => {
    const c = markStale(withEntries({ x: 1, y: 2 }), "a", (k) => k === "x");
    expect(getEntry(c, "a", "x", T0)!.stale).toBe(true);
    expect(getEntry(c, "a", "y", T0)!.stale).toBe(false);
  });

  it("markStale on an unknown connection is a no-op", () => {
    const c = withEntries({ x: 1 });
    expect(markStale(c, "nope")).toBe(c);
  });
});

describe("ddlTargets", () => {
  it("is null for a script that changes no metadata", () => {
    expect(ddlTargets("SELECT * FROM t")).toBeNull();
    expect(ddlTargets("insert into t values (1); update t set a = 2")).toBeNull();
    expect(ddlTargets("TRUNCATE TABLE t")).toBeNull();
    expect(ddlTargets("select 'drop table t' from x -- alter table y")).toBeNull();
  });

  it("names the tables a table/view statement touches", () => {
    expect(ddlTargets("ALTER TABLE users ADD COLUMN age int")).toEqual({ tables: ["users"] });
    expect(ddlTargets("create table if not exists public.orders(id int)")).toEqual({ tables: ["orders"] });
    expect(ddlTargets('CREATE OR REPLACE VIEW "s"."v_x" AS SELECT 1')).toEqual({ tables: ["v_x"] });
    expect(ddlTargets("drop table a, b cascade")).toEqual({ tables: ["a", "b"] });
    expect(ddlTargets("DROP TABLE `db`.`t`")).toEqual({ tables: ["t"] });
    expect(ddlTargets("alter table [dbo].[Items] add x int")).toEqual({ tables: ["Items"] });
    expect(ddlTargets("drop table stores:informix.customer")).toEqual({ tables: ["customer"] });
    expect(ddlTargets("rename table a to b, c to d")).toEqual({ tables: ["a", "b", "c", "d"] });
  });

  it("indexes, routines and triggers change the tree only", () => {
    expect(ddlTargets("CREATE UNIQUE INDEX ix ON t(a)")).toEqual({ tables: [] });
    expect(ddlTargets("create or replace function f() returns int as $$ select 1 $$")).toEqual({ tables: [] });
    expect(ddlTargets("DROP TRIGGER trg")).toEqual({ tables: [] });
  });

  it("is conservative: anything it cannot read means everything", () => {
    expect(ddlTargets("CREATE DATABASE x")).toBe("all");
    expect(ddlTargets("drop schema s cascade")).toBe("all");
    expect(ddlTargets("ALTER TABLE a RENAME TO b")).toBe("all");
    expect(ddlTargets("create table t1(id int); create schema s")).toBe("all");
  });

  it("collects across statements", () => {
    expect(ddlTargets("alter table a add x int; select 1; drop view v")).toEqual({ tables: ["a", "v"] });
  });
});

describe("invalidateForSql", () => {
  const base = () =>
    withEntries({
      [treeKey("")]: [],
      [treeKey("db:main")]: [],
      [colsKey("Users")]: ["id"],
      [colsKey("orders")]: ["id"],
    });
  const staleKeys = (c: MetaCache) =>
    listEntries(c, "a", "", T0).filter((x) => x.entry.stale).map((x) => x.key).sort();

  it("marks every tree level and the altered table's columns (case-insensitive)", () => {
    expect(staleKeys(invalidateForSql(base(), "a", "alter table USERS add x int"))).toEqual([
      "cols:Users",
      "tree:",
      "tree:db:main",
    ]);
  });

  it("a CREATE INDEX leaves columns alone", () => {
    expect(staleKeys(invalidateForSql(base(), "a", "create index i on orders(id)"))).toEqual([
      "tree:",
      "tree:db:main",
    ]);
  });

  it("an unreadable statement marks the whole connection", () => {
    expect(staleKeys(invalidateForSql(base(), "a", "create schema s"))).toHaveLength(4);
  });

  it("a plain query changes nothing", () => {
    const c = base();
    expect(invalidateForSql(c, "a", "select 1")).toBe(c);
  });

  it("only touches the given connection", () => {
    let c = base();
    c = openConn(c, "b", "fp");
    c = putEntry(c, "b", colsKey("users"), ["id"], T0).cache;
    c = invalidateForSql(c, "a", "drop table users");
    expect(getEntry(c, "b", colsKey("users"), T0)!.stale).toBe(false);
  });
});

describe("per-connection lifecycle", () => {
  it("openConn keeps entries when the fingerprint matches", () => {
    const c = withEntries({ k: 1 });
    expect(openConn(c, "a", "fp")).toBe(c);
  });

  it("openConn drops the entries when the params changed", () => {
    const c = openConn(withEntries({ k: 1 }), "a", "fp2");
    expect(getEntry(c, "a", "k", T0)).toBeUndefined();
    expect(c.a!.fp).toBe("fp2");
  });

  it("clearConn forgets one connection only", () => {
    let c = withEntries({ k: 1 });
    c = openConn(c, "b", "fp");
    c = putEntry(c, "b", "k", 2, T0).cache;
    c = clearConn(c, "a");
    expect(c.a).toBeUndefined();
    expect(getEntry(c, "b", "k", T0)!.value).toBe(2);
    expect(clearConn(c, "nope")).toBe(c);
  });
});

describe("LRU eviction under the size cap", () => {
  // Each entry is key (1 char) + JSON of a 8-char string (10) = 11 chars.
  const v = "xxxxxxxx";

  it("evicts the least recently used entries, across connections", () => {
    let c = openConn(openConn({}, "a", "fp"), "b", "fp");
    c = putEntry(c, "a", "1", v, T0, 40).cache;
    c = putEntry(c, "b", "2", v, T0 + 1, 40).cache;
    c = putEntry(c, "a", "3", v, T0 + 2, 40).cache;
    c = touch(c, "a", "1", T0 + 3); // "1" is now more recent than "2"
    const r = putEntry(c, "a", "4", v, T0 + 4, 40);
    expect(r.ok).toBe(true);
    expect(getEntry(r.cache, "b", "2", T0)).toBeUndefined();
    expect(getEntry(r.cache, "a", "1", T0)).toBeDefined();
    expect(getEntry(r.cache, "a", "3", T0)).toBeDefined();
    expect(getEntry(r.cache, "a", "4", T0)).toBeDefined();
  });

  it("refuses (and reports) a value larger than the whole cap", () => {
    const c = withEntries({ k: 1 });
    const r = putEntry(c, "a", "big", "y".repeat(50), T0, 40);
    expect(r.ok).toBe(false);
    expect(r.cache).toBe(c);
  });

  it("defaults to CACHE_CAP", () => {
    const r = putEntry(withEntries({}), "a", "big", "y".repeat(CACHE_CAP), T0);
    expect(r.ok).toBe(false);
  });
});

describe("serialization", () => {
  it("round-trips", () => {
    const c = markStale(withEntries({ [treeKey("")]: [{ name: "main", kind: "database" }], x: 1 }), "a", (k) => k === "x");
    expect(parseCache(serializeCache(c))).toEqual(c);
  });

  it("ignores corrupted data safely", () => {
    expect(parseCache(null)).toEqual({});
    expect(parseCache("")).toEqual({});
    expect(parseCache("{not json")).toEqual({});
    expect(parseCache("null")).toEqual({});
    expect(parseCache("[]")).toEqual({});
    expect(parseCache(JSON.stringify({ v: 2, c: {} }))).toEqual({});
  });

  it("drops malformed connections and entries, keeping the good ones", () => {
    const raw = JSON.stringify({
      v: 1,
      c: {
        good: { fp: "f", e: { ok: { v: 1, at: 1, used: 1, s: 3 }, bad: { v: 1 }, nul: null } },
        nofp: { e: {} },
        junk: 7,
      },
    });
    expect(parseCache(raw)).toEqual({ good: { fp: "f", e: { ok: { v: 1, at: 1, used: 1, s: 3 } } } });
  });
});

describe("createMetaCacheStore", () => {
  afterEach(() => vi.useRealTimers());

  const memKv = (init?: string): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>(init ? [[STORAGE_KEY, init]] : []);
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    };
  };

  it("persists what was put and reads it back in a new session", () => {
    const kv = memKv();
    const s1 = createMetaCacheStore(kv, undefined, () => T0);
    s1.open("a", "fp");
    s1.conn("a").put(treeKey(""), ["x"]);
    s1.flush();
    const s2 = createMetaCacheStore(kv, undefined, () => T0 + 10);
    s2.open("a", "fp");
    expect(s2.conn("a").get(treeKey(""))).toEqual({ value: ["x"], fetchedAt: T0, stale: false });
  });

  it("writes debounced, not on every put", () => {
    vi.useFakeTimers();
    const kv = memKv();
    const s = createMetaCacheStore(kv);
    s.open("a", "fp");
    s.conn("a").put("k", 1);
    expect(kv.data.has(STORAGE_KEY)).toBe(false);
    vi.advanceTimersByTime(600);
    expect(kv.data.has(STORAGE_KEY)).toBe(true);
  });

  it("starts empty from corrupted storage", () => {
    const s = createMetaCacheStore(memKv("{garbage"));
    s.open("a", "fp");
    expect(s.conn("a").get("k")).toBeUndefined();
  });

  it("reports a storage failure instead of throwing", () => {
    const onProblem = vi.fn();
    const kv: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const s = createMetaCacheStore(kv, onProblem);
    s.open("a", "fp");
    s.conn("a").put("k", 1);
    expect(() => s.flush()).not.toThrow();
    expect(onProblem).toHaveBeenCalledWith("storage");
  });

  it("reports a value too large to cache", () => {
    const onProblem = vi.fn();
    const s = createMetaCacheStore(memKv(), onProblem);
    s.open("a", "fp");
    s.conn("a").put("k", "y".repeat(CACHE_CAP));
    expect(onProblem).toHaveBeenCalledWith("tooLarge");
  });

  it("invalidateSql marks and answers what it decided; markStale marks all", () => {
    const s = createMetaCacheStore(memKv(), undefined, () => T0);
    s.open("a", "fp");
    s.conn("a").put(colsKey("users"), ["id"]);
    s.conn("a").put(colsKey("orders"), ["id"]);
    expect(s.invalidateSql("a", "alter table users add x int")).toEqual({ tables: ["users"] });
    expect(s.conn("a").get(colsKey("users"))!.stale).toBe(true);
    expect(s.conn("a").get(colsKey("orders"))!.stale).toBe(false);
    s.markStale("a");
    expect(s.list("a", "cols:").every((x) => x.entry.stale)).toBe(true);
  });

  it("re-opening with other params drops the connection's entries", () => {
    const s = createMetaCacheStore(memKv());
    s.open("a", "fp1");
    s.conn("a").put("k", 1);
    s.open("a", "fp2");
    expect(s.conn("a").get("k")).toBeUndefined();
  });
});
