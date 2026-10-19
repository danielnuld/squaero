import { describe, it, expect } from "vitest";
import {
  touchConnection,
  recentConnections,
  parseUsage,
  loadUsage,
  saveUsage,
  USAGE_KEY,
} from "../../src/utils/recentConnections";

const saved = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

describe("touchConnection", () => {
  it("records the time without mutating the map", () => {
    const m = { a: 1 };
    const n = touchConnection(m, "b", 5);
    expect(n).toEqual({ a: 1, b: 5 });
    expect(m).toEqual({ a: 1 });
    expect(touchConnection(n, "a", 9).a).toBe(9);
  });
});

describe("recentConnections", () => {
  it("puts the most recently used first, then the unused in saved order", () => {
    const r = recentConnections(saved, { c: 10, a: 20 });
    expect(r.map((x) => [x.conn.id, x.at])).toEqual([
      ["a", 20],
      ["c", 10],
      ["b", null],
      ["d", null],
    ]);
  });

  it("ignores usage of connections that no longer exist, and caps", () => {
    expect(recentConnections(saved, { zz: 99, d: 1 }, 2).map((x) => x.conn.id)).toEqual(["d", "a"]);
    expect(recentConnections([], { a: 1 })).toEqual([]);
    expect(recentConnections(saved, {}, 0)).toEqual([]);
  });
});

describe("usage persistence", () => {
  it("parses only finite numbers and survives garbage", () => {
    expect(parseUsage('{"a":1,"b":"x","c":null}')).toEqual({ a: 1 });
    expect(parseUsage("[1,2]")).toEqual({});
    expect(parseUsage("{oops")).toEqual({});
    expect(parseUsage(null)).toEqual({});
  });

  it("saves only connections that still exist", () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    saveUsage(store, { a: 1, gone: 2 }, ["a", "b"]);
    expect(JSON.parse(map.get(USAGE_KEY)!)).toEqual({ a: 1 });
    expect(loadUsage(store)).toEqual({ a: 1 });
  });

  it("never throws on a blocked store", () => {
    const bad = {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
    };
    expect(loadUsage(bad)).toEqual({});
    expect(() => saveUsage(bad, { a: 1 }, ["a"])).not.toThrow();
  });
});
