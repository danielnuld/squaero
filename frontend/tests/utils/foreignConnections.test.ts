import { describe, it, expect } from "vitest";
import {
  applyCredentials,
  detectForeign,
  driverFor,
  parseDbeaver,
  parseNavicat,
} from "../../src/utils/foreignConnections";

// Reading the connection lists of DBeaver and Navicat, so migrating does not
// start with retyping thirty servers. What these tests pin is the two rules the
// module exists for: a connection arrives whole — password included, when the
// file has one this can read — and an entry is only ever dropped when it is
// genuinely unusable, never because a version spelled a field differently.

const DBEAVER = JSON.stringify({
  folders: { Prod: {} },
  connections: {
    "postgres-jdbc-18f2": {
      provider: "postgresql",
      driver: "postgres-jdbc",
      name: "Ventas prod",
      folder: "Prod",
      "save-password": true,
      configuration: {
        host: "db.example.com",
        port: "5432",
        database: "ventas",
        user: "app",
        password: "hunter2",
        url: "jdbc:postgresql://db.example.com:5432/ventas",
      },
    },
    "mysql8-1a2b": {
      provider: "mysql",
      name: "Local MySQL",
      configuration: { host: "127.0.0.1", port: "3306", database: "testdb" },
    },
    "sqlite-99": {
      provider: "sqlite",
      name: "Notas",
      configuration: { database: "C:/data/notas.db" },
    },
    "oracle-77": {
      provider: "oracle",
      name: "Cobranza",
      configuration: { host: "orcl.example.com", port: "1521" },
    },
  },
});

const NAVICAT = `<?xml version="1.0" encoding="UTF-8"?>
<Connections>
  <Connection ConnectionName="SIAJ" ConnType="MySQL" Host="10.0.0.9" Port="3306"
              UserName="root" Password="A3F2C1" Database="siaj" SavePassword="true"/>
  <Connection ConnectionName="Reportes" ConnType="PostgreSQL" Host="pg.example.com"
              Port="5432" UserName="reader" DefaultDatabase="reportes"
              SSH_Host="bastion.example.com" SSH_Port="2222" SSH_UserName="dnl"/>
  <Connection ConnectionName="Local" ConnType="SQLite" DatabaseFileName="/home/d/n.db"/>
  <Connection ConnectionName="Nómina" ConnType="Oracle" Host="orcl.example.com"/>
</Connections>`;

describe("detectForeign", () => {
  it("tells the two formats apart by content, not by extension", () => {
    expect(detectForeign(DBEAVER)).toBe("dbeaver");
    expect(detectForeign(NAVICAT)).toBe("navicat");
  });

  it("does not claim our own export file", () => {
    const ours = JSON.stringify({
      version: 1,
      connections: [{ id: "c1", name: "x", driver: "mysql", params: { host: "h" } }],
    });
    expect(detectForeign(ours)).toBeNull();
    expect(detectForeign("")).toBeNull();
    expect(detectForeign("not a file")).toBeNull();
  });
});

describe("driverFor", () => {
  it("maps every spelling of an engine we ship", () => {
    expect(driverFor("postgresql")).toBe("postgres");
    expect(driverFor("MariaDB")).toBe("mysql");
    expect(driverFor("mongo db")).toBe("mongodb");
    expect(driverFor("SQLite")).toBe("sqlite");
    expect(driverFor("sqlserver")).toBe("mssql"); // DBeaver's provider (#516)
    expect(driverFor("mssql")).toBe("mssql");     // its older one
  });

  it("says nothing for an engine we do not ship", () => {
    expect(driverFor("oracle")).toBe("");
    expect(driverFor("")).toBe("");
  });
});

describe("parseDbeaver", () => {
  const parsed = () => {
    const r = parseDbeaver(DBEAVER);
    if ("error" in r) throw new Error(r.error);
    return r;
  };

  it("reads the address of each connection, and its folder as the group", () => {
    const { connections } = parsed();
    expect(connections.map((c) => c.name)).toEqual(["Ventas prod", "Local MySQL", "Notas"]);
    expect(connections[0]).toEqual({
      id: "",
      name: "Ventas prod",
      driver: "postgres",
      group: "Prod",
      params: {
        host: "db.example.com",
        port: "5432",
        database: "ventas",
        user: "app",
        password: "hunter2",
      },
    });
  });

  it("takes a password the file left in the clear", () => {
    // Some DBeaver versions keep it right in data-sources.json; the rest put it
    // in credentials-config.json, which applyCredentials() fills in.
    expect(parsed().connections[0].params.password).toBe("hunter2");
    expect(parsed().connections[1].params.password).toBeUndefined();
  });

  it("keeps a connection whose user is missing", () => {
    // DBeaver's user often lives in its encrypted credentials file, so half an
    // address is the normal case — and it is still worth not retyping.
    const mysql = parsed().connections[1];
    expect(mysql.params).toEqual({ host: "127.0.0.1", port: "3306", database: "testdb" });
  });

  it("puts a SQLite file in the path field, not in host", () => {
    expect(parsed().connections[2].params).toEqual({ path: "C:/data/notas.db" });
  });

  it("reports an engine it cannot map instead of guessing one", () => {
    expect(parsed().skipped).toEqual([{ name: "Cobranza", reason: "oracle" }]);
  });

  it("reads the SSH tunnel from either shape DBeaver writes it in", () => {
    const flat = JSON.stringify({
      connections: {
        a: {
          provider: "mysql",
          name: "Tunelada",
          configuration: {
            host: "10.0.0.2",
            handlers: { ssh_tunnel: { properties: { host: "jump.example.com", port: "22", user: "dnl" } } },
          },
        },
      },
    });
    const listed = JSON.stringify({
      connections: {
        a: {
          provider: "mysql",
          name: "Tunelada",
          configuration: {
            host: "10.0.0.2",
            "network-handlers": [{ id: "ssh_tunnel", properties: { host: "jump.example.com", port: "22", user: "dnl" } }],
          },
        },
      },
    });
    for (const raw of [flat, listed]) {
      const r = parseDbeaver(raw);
      if ("error" in r) throw new Error(r.error);
      expect(r.connections[0].params).toMatchObject({
        ssh_host: "jump.example.com",
        ssh_port: "22",
        ssh_user: "dnl",
      });
    }
  });

  it("refuses a file that is not one of DBeaver's", () => {
    expect(parseDbeaver("{oops")).toEqual({ error: "El archivo de DBeaver no es JSON válido." });
    expect(parseDbeaver("{}")).toEqual({ error: "El archivo de DBeaver no contiene conexiones." });
  });
});

describe("parseNavicat", () => {
  const parsed = async () => {
    const r = await parseNavicat(NAVICAT);
    if ("error" in r) throw new Error(r.error);
    return r;
  };

  it("reads every connection it can, with its SSH tunnel", async () => {
    const { connections } = await parsed();
    expect(connections.map((c) => c.name)).toEqual(["SIAJ", "Reportes", "Local"]);
    expect(connections[0]).toEqual({
      id: "",
      name: "SIAJ",
      driver: "mysql",
      params: { host: "10.0.0.9", port: "3306", database: "siaj", user: "root" },
    });
    expect(connections[1].params).toEqual({
      host: "pg.example.com",
      port: "5432",
      database: "reportes",
      user: "reader",
      ssh_host: "bastion.example.com",
      ssh_port: "2222",
      ssh_user: "dnl",
    });
  });

  it("counts a password it cannot read instead of storing the ciphertext", async () => {
    // "A3F2C1" is not a Navicat 12 blob — the reader must not pass it through.
    const r = await parsed();
    expect(JSON.stringify(r.connections)).not.toContain("A3F2C1");
    expect(r.locked).toBe(1);
  });

  it("puts a SQLite file in the path field", async () => {
    expect((await parsed()).connections[2].params).toEqual({ path: "/home/d/n.db" });
  });

  it("reports an engine it cannot map", async () => {
    expect((await parsed()).skipped).toEqual([{ name: "Nómina", reason: "Oracle" }]);
  });

  it("refuses a file that is not one of Navicat's", async () => {
    expect(await parseNavicat("<Connections></Connections>")).toEqual({
      error: "El archivo de Navicat no contiene conexiones.",
    });
  });
});

// Issue #516: SQL Server, with the provider and driver ids DBeaver's own
// plugin.xml declares, its instance and encryption from the host or JDBC URL.
describe("SQL Server from DBeaver", () => {
  const one = (entry: Record<string, unknown>) => {
    const r = parseDbeaver(JSON.stringify({ connections: { x: { name: "Nómina", ...entry } } }));
    if ("error" in r) throw new Error(r.error);
    return r;
  };

  it("reads the address, and the driver's encrypt property", () => {
    const r = one({
      provider: "sqlserver",
      driver: "microsoft",
      configuration: {
        host: "mssql.example.com",
        port: "1433",
        database: "nomina",
        user: "sa",
        url: "jdbc:sqlserver://mssql.example.com:1433;databaseName=nomina",
        properties: { encrypt: "true", trustServerCertificate: "true" },
      },
    });
    expect(r.connections[0]).toEqual({
      id: "",
      name: "Nómina",
      driver: "mssql",
      params: { host: "mssql.example.com", port: "1433", database: "nomina", user: "sa", encryption: "require" },
    });
  });

  it("takes a named instance from the host, and drops the port for the SQL Browser", () => {
    const r = one({
      provider: "sqlserver",
      driver: "microsoft",
      configuration: { host: "srv01\\SQLEXPRESS", port: "1433", url: "jdbc:sqlserver://srv01\\SQLEXPRESS;encrypt=false" },
    });
    expect(r.connections[0].params).toEqual({ host: "srv01", instance: "SQLEXPRESS", encryption: "off" });
  });

  it("reads jTDS's URL: database, instance and ssl", () => {
    const r = one({
      provider: "sqlserver",
      driver: "jtds",
      configuration: { url: "jdbc:jtds:sqlserver://srv02:1433/ventas;instance=PROD;ssl=request" },
    });
    expect(r.connections[0].params).toEqual({ host: "srv02", database: "ventas", instance: "PROD", encryption: "request" });
  });

  it("leaves Sybase alone: the old mssql provider carries its drivers too", () => {
    const r = one({ provider: "mssql", driver: "sybase_jtds", configuration: { host: "ase", port: "5000" } });
    expect(r.connections).toEqual([]);
    expect(r.skipped).toEqual([{ name: "Nómina", reason: "Sybase" }]);
    expect(one({ provider: "mssql", driver: "mssql_jdbc_ms_new", configuration: { host: "h" } }).connections[0].driver)
      .toBe("mssql");
  });
});

// Issue #391: DBeaver keeps user and password in a second, encrypted file, keyed
// by its own connection id — which is why the reader carries that id along.
describe("applyCredentials", () => {
  const base = () => {
    const r = parseDbeaver(DBEAVER);
    if ("error" in r) throw new Error(r.error);
    return r;
  };

  it("fills the password in, matched by DBeaver's own id", () => {
    const out = applyCredentials(base(), {
      "mysql8-1a2b": { user: "root", password: "s3cr3t" },
    });
    expect(out.connections[1].params).toMatchObject({ user: "root", password: "s3cr3t" });
    // A connection the credentials file says nothing about is left alone.
    expect(out.connections[0].params.password).toBe("hunter2");
  });

  it("does not overwrite a user the connection file already had", () => {
    const out = applyCredentials(base(), { "postgres-jdbc-18f2": { user: "otro", password: "p" } });
    expect(out.connections[0].params.user).toBe("app");
    // The credentials file is the newer word on the password, though.
    expect(out.connections[0].params.password).toBe("p");
  });

  it("is a no-op when there are no credentials to apply", () => {
    expect(applyCredentials(base(), {})).toEqual(base());
  });
});
