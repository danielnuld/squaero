import { describe, it, expect } from "vitest";
import {
  exportConnections,
  importConnections,
  summaryText,
  CONNECTIONS_FILE_VERSION,
  type ImportOutcome,
} from "../../src/utils/connectionsIO";
import type { Connection } from "../../src/utils/connections";

const mysql = (id: string, name: string, password = "secret"): Connection => ({
  id,
  name,
  driver: "mysql",
  params: { host: "127.0.0.1", user: "root", database: "db", password },
});

describe("exportConnections", () => {
  it("omits passwords by default and keeps the rest", () => {
    const json = exportConnections([mysql("conn-1", "Prod")], false);
    const file = JSON.parse(json);
    expect(file.version).toBe(CONNECTIONS_FILE_VERSION);
    expect(file.connections[0].params.password).toBeUndefined();
    expect(file.connections[0].params.host).toBe("127.0.0.1");
    expect(json).not.toContain("secret"); // never dumped
  });

  it("includes passwords only on the explicit opt-in", () => {
    const json = exportConnections([mysql("conn-1", "Prod")], true);
    expect(JSON.parse(json).connections[0].params.password).toBe("secret");
  });

  it("strips secret-looking fields for an unknown driver", () => {
    const c: Connection = { id: "x", name: "Weird", driver: "unknown", params: { host: "h", password: "p", ssh_passphrase: "q" } };
    const file = JSON.parse(exportConnections([c], false));
    expect(file.connections[0].params.password).toBeUndefined();
    expect(file.connections[0].params.ssh_passphrase).toBeUndefined();
    expect(file.connections[0].params.host).toBe("h");
  });
});

describe("importConnections", () => {
  const asOutcome = (r: ImportOutcome | { error: string }) => {
    expect("summary" in r).toBe(true);
    return r as ImportOutcome;
  };

  it("adds new connections", () => {
    const file = exportConnections([mysql("conn-1", "Prod", "")], false);
    const out = asOutcome(importConnections([], file));
    expect(out.summary).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(out.list[0].name).toBe("Prod");
  });

  it("updates an existing connection matched by name (keeps its id)", () => {
    const existing = [mysql("conn-1", "Prod", "old")];
    const file = exportConnections([{ ...mysql("conn-9", "prod", ""), params: { host: "10.0.0.1", user: "root", database: "db" } }], false);
    const out = asOutcome(importConnections(existing, file));
    expect(out.summary).toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(out.list).toHaveLength(1);
    expect(out.list[0].id).toBe("conn-1"); // existing id kept
    expect(out.list[0].params.host).toBe("10.0.0.1"); // replaced
  });

  it("regenerates a colliding id for a genuinely different connection", () => {
    const existing = [mysql("conn-1", "Prod", "")];
    // same id, different name -> must be added with a fresh id, not clobber Prod
    const file = exportConnections([mysql("conn-1", "Staging", "")], false);
    const out = asOutcome(importConnections(existing, file));
    expect(out.summary).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(out.list).toHaveLength(2);
    const ids = out.list.map((c) => c.id);
    expect(new Set(ids).size).toBe(2); // no duplicate ids
    expect(out.list.find((c) => c.name === "Prod")!.id).toBe("conn-1");
  });

  it("regenerates a blank id on import so no stored connection has an empty id", () => {
    const raw = JSON.stringify({
      version: CONNECTIONS_FILE_VERSION,
      connections: [
        { id: "", name: "NoId", driver: "sqlite", params: { path: "/a.db" } },
        { id: "   ", name: "AlsoNoId", driver: "sqlite", params: { path: "/b.db" } },
      ],
    });
    const out = asOutcome(importConnections([], raw));
    expect(out.summary).toEqual({ added: 2, updated: 0, skipped: 0 });
    for (const c of out.list) expect(c.id.trim()).not.toBe("");
    expect(new Set(out.list.map((c) => c.id)).size).toBe(2); // distinct ids
  });

  it("skips malformed and invalid entries", () => {
    const raw = JSON.stringify({
      version: CONNECTIONS_FILE_VERSION,
      connections: [
        { id: "a", name: "", driver: "mysql", params: { host: "h", user: "u" } }, // blank name
        { id: "b", name: "Bad", driver: "nope", params: {} }, // unknown driver
        { id: "c", name: "Good", driver: "sqlite", params: { path: "/x.db" } }, // valid
        42, // not an object
      ],
    });
    const out = asOutcome(importConnections([], raw));
    expect(out.summary).toEqual({ added: 1, updated: 0, skipped: 3 });
    expect(out.list[0].name).toBe("Good");
  });

  it("rejects bad JSON, wrong shape, and unsupported versions", () => {
    expect(importConnections([], "{not json")).toEqual({ error: expect.stringContaining("JSON") });
    expect(importConnections([], JSON.stringify([1, 2]))).toEqual({ error: expect.any(String) });
    expect(importConnections([], JSON.stringify({ version: 99, connections: [] }))).toEqual({
      error: expect.stringContaining("Versión"),
    });
    expect(importConnections([], JSON.stringify({ version: 1, connections: "nope" }))).toEqual({
      error: expect.any(String),
    });
  });
});

describe("summaryText", () => {
  it("formats the counts", () => {
    expect(summaryText({ added: 2, updated: 1, skipped: 0 })).toBe("Añadidas 2 · actualizadas 1 · omitidas 0");
  });
});
