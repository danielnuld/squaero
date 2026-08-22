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
  it("omits passwords by default and keeps the rest", async () => {
    const json = exportConnections([mysql("conn-1", "Prod")], false);
    const file = JSON.parse(json);
    expect(file.version).toBe(CONNECTIONS_FILE_VERSION);
    expect(file.connections[0].params.password).toBeUndefined();
    expect(file.connections[0].params.host).toBe("127.0.0.1");
    expect(json).not.toContain("secret"); // never dumped
  });

  it("includes passwords only on the explicit opt-in", async () => {
    const json = exportConnections([mysql("conn-1", "Prod")], true);
    expect(JSON.parse(json).connections[0].params.password).toBe("secret");
  });

  it("strips secret-looking fields for an unknown driver", async () => {
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

  it("adds new connections", async () => {
    const file = exportConnections([mysql("conn-1", "Prod", "")], false);
    const out = asOutcome(await importConnections([], file));
    expect(out.summary).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(out.list[0].name).toBe("Prod");
  });

  it("updates an existing connection matched by name (keeps its id)", async () => {
    const existing = [mysql("conn-1", "Prod", "old")];
    const file = exportConnections([{ ...mysql("conn-9", "prod", ""), params: { host: "10.0.0.1", user: "root", database: "db" } }], false);
    const out = asOutcome(await importConnections(existing, file));
    expect(out.summary).toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(out.list).toHaveLength(1);
    expect(out.list[0].id).toBe("conn-1"); // existing id kept
    expect(out.list[0].params.host).toBe("10.0.0.1"); // replaced
  });

  it("regenerates a colliding id for a genuinely different connection", async () => {
    const existing = [mysql("conn-1", "Prod", "")];
    // same id, different name -> must be added with a fresh id, not clobber Prod
    const file = exportConnections([mysql("conn-1", "Staging", "")], false);
    const out = asOutcome(await importConnections(existing, file));
    expect(out.summary).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(out.list).toHaveLength(2);
    const ids = out.list.map((c) => c.id);
    expect(new Set(ids).size).toBe(2); // no duplicate ids
    expect(out.list.find((c) => c.name === "Prod")!.id).toBe("conn-1");
  });

  it("regenerates a blank id on import so no stored connection has an empty id", async () => {
    const raw = JSON.stringify({
      version: CONNECTIONS_FILE_VERSION,
      connections: [
        { id: "", name: "NoId", driver: "sqlite", params: { path: "/a.db" } },
        { id: "   ", name: "AlsoNoId", driver: "sqlite", params: { path: "/b.db" } },
      ],
    });
    const out = asOutcome(await importConnections([], raw));
    expect(out.summary).toEqual({ added: 2, updated: 0, skipped: 0 });
    for (const c of out.list) expect(c.id.trim()).not.toBe("");
    expect(new Set(out.list.map((c) => c.id)).size).toBe(2); // distinct ids
  });

  it("skips malformed and invalid entries", async () => {
    const raw = JSON.stringify({
      version: CONNECTIONS_FILE_VERSION,
      connections: [
        { id: "a", name: "", driver: "mysql", params: { host: "h", user: "u" } }, // blank name
        { id: "b", name: "Bad", driver: "nope", params: {} }, // unknown driver
        { id: "c", name: "Good", driver: "sqlite", params: { path: "/x.db" } }, // valid
        42, // not an object
      ],
    });
    const out = asOutcome(await importConnections([], raw));
    expect(out.summary).toEqual({ added: 1, updated: 0, skipped: 3 });
    expect(out.list[0].name).toBe("Good");
  });

  it("rejects bad JSON, wrong shape, and unsupported versions", async () => {
    expect(await importConnections([], "{not json")).toEqual({ error: expect.stringContaining("JSON") });
    expect(await importConnections([], JSON.stringify([1, 2]))).toEqual({ error: expect.any(String) });
    expect(await importConnections([], JSON.stringify({ version: 99, connections: [] }))).toEqual({
      error: expect.stringContaining("Versión"),
    });
    expect(await importConnections([], JSON.stringify({ version: 1, connections: "nope" }))).toEqual({
      error: expect.any(String),
    });
  });
});

// A file from another tool goes through the same merge (issue: DBeaver/Navicat
// import). What is defended here is the routing and the honesty of the summary.
describe("importConnections — other tools", () => {
  const dbeaver = JSON.stringify({
    connections: {
      a: {
        provider: "postgresql",
        name: "Ventas prod",
        configuration: { host: "db.example.com", port: "5432", database: "ventas", user: "app", password: "hunter2" },
      },
      b: { provider: "oracle", name: "Cobranza", configuration: { host: "orcl" } },
    },
  });

  const navicat = `<?xml version="1.0" encoding="UTF-8"?>
<Connections><Connection ConnectionName="ERP" ConnType="MySQL" Host="10.0.0.9" Port="3306" UserName="root" Password="A3F2C1"/></Connections>`;

  it("imports a DBeaver file, gives it an id, and brings the password", async () => {
    const out = (await importConnections([], dbeaver)) as ImportOutcome;
    expect(out.summary.added).toBe(1);
    expect(out.summary.source).toBe("dbeaver");
    expect(out.list[0].id).not.toBe("");
    expect(out.list[0].params.password).toBe("hunter2");
  });

  it("fills passwords in from the credentials file DBeaver keeps beside it", async () => {
    // Built the way DBeaver writes it: AES-CBC with its own fixed key, a zero
    // IV, and sixteen bytes of junk before the JSON.
    const json = new TextEncoder().encode(
      JSON.stringify({ b: { "#connection": { user: "root", password: "s3cr3t" } } }),
    );
    const plain = new Uint8Array(16 + json.length);
    plain.set(json, 16);
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(
        "babb4a9f774ab853c96c2d653dfe544a".match(/../g)!.map((h) => parseInt(h, 16)),
      ) as unknown as BufferSource,
      "AES-CBC",
      false,
      ["encrypt"],
    );
    const creds = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: new Uint8Array(16) as unknown as BufferSource },
      key,
      plain as unknown as BufferSource,
    );

    const withCreds = JSON.stringify({
      connections: {
        b: { provider: "mysql", name: "Sin usuario", configuration: { host: "10.0.0.2" } },
      },
    });
    const out = (await importConnections([], withCreds, creds)) as ImportOutcome;
    expect(out.list[0].params).toMatchObject({ user: "root", password: "s3cr3t" });
    expect(out.summary.passwords).toBe(1);
    expect(out.summary.locked).toBe(0);
  });

  it("imports a Navicat file even though it is not JSON at all", async () => {
    const out = (await importConnections([], navicat)) as ImportOutcome;
    expect(out.summary.source).toBe("navicat");
    expect(out.list.map((c) => c.name)).toEqual(["ERP"]);
  });

  it("updates a connection already saved under the same name", async () => {
    const existing = [mysql("c9", "ERP")];
    const out = (await importConnections(existing, navicat)) as ImportOutcome;
    expect(out.summary).toMatchObject({ added: 0, updated: 1 });
    expect(out.list).toHaveLength(1);
    expect(out.list[0].id).toBe("c9");
  });

  it("says which tool it read, how many passwords came, and what it could not map", async () => {
    const out = (await importConnections([], dbeaver)) as ImportOutcome;
    const text = summaryText(out.summary);
    expect(text).toContain("DBeaver");
    expect(text).toContain("1 con contraseña");
    expect(text).toContain("oracle");
  });

  it("counts the passwords it could not read, so the gap is visible", async () => {
    // A Navicat 11 blob: recognisably a password, unreadable by this reader.
    const old = `<?xml version="1.0"?><Connections><Connection ConnectionName="Vieja" ConnType="MySQL" Host="h" Password="A3F2C1"/></Connections>`;
    const out = (await importConnections([], old)) as ImportOutcome;
    expect(out.summary.locked).toBe(1);
    expect(summaryText(out.summary)).toContain("1 sin contraseña");
  });
});

describe("summaryText", () => {
  it("formats the counts", async () => {
    expect(summaryText({ added: 2, updated: 1, skipped: 0 })).toBe("Añadidas 2 · actualizadas 1 · omitidas 0");
  });
});
