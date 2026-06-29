import { describe, it, expect } from "vitest";
import {
  driverSchema,
  secretFieldKeys,
  stripSecrets,
  validateConnection,
  buildDsn,
  nextConnectionId,
  upsertConnection,
  removeConnection,
  serializeConnections,
  parseConnections,
  withSshTunnel,
  SSH_TUNNEL_FIELDS,
  SSH_GROUP,
  MYSQL_SSL_FIELDS,
  SSL_GROUP,
  DRIVER_SCHEMAS,
  type Connection,
  type DriverField,
} from "../../src/utils/connections";

const sqliteConn = (over: Partial<Connection> = {}): Connection => ({
  id: "conn-1",
  name: "Local",
  driver: "sqlite",
  params: { path: "/tmp/app.db" },
  ...over,
});

const pgConn = (over: Partial<Connection> = {}): Connection => ({
  id: "conn-2",
  name: "PG",
  driver: "postgres",
  params: { host: "localhost", database: "app", user: "me", password: "secret" },
  ...over,
});

describe("driverSchema", () => {
  it("returns the schema for a known driver", () => {
    expect(driverSchema("sqlite")?.label).toBe("SQLite");
  });
  it("returns undefined for an unknown driver", () => {
    expect(driverSchema("nope")).toBeUndefined();
  });
});

describe("secretFieldKeys", () => {
  it("is empty for sqlite", () => {
    expect(secretFieldKeys(DRIVER_SCHEMAS.sqlite)).toEqual([]);
  });
  it("finds every password field for postgres, including SSH secrets", () => {
    expect(secretFieldKeys(DRIVER_SCHEMAS.postgres)).toEqual([
      "password",
      "ssh_password",
      "ssh_key_passphrase",
    ]);
  });
});

describe("stripSecrets", () => {
  it("drops secret values, keeps the rest", () => {
    const stripped = stripSecrets(pgConn(), DRIVER_SCHEMAS.postgres);
    expect(stripped.params).toEqual({ host: "localhost", database: "app", user: "me" });
    expect("password" in stripped.params).toBe(false);
  });
  it("leaves a secret-free connection untouched", () => {
    const c = sqliteConn();
    expect(stripSecrets(c, DRIVER_SCHEMAS.sqlite).params).toEqual({ path: "/tmp/app.db" });
  });
});

describe("validateConnection", () => {
  it("accepts a valid sqlite connection", () => {
    expect(validateConnection(sqliteConn())).toEqual([]);
  });
  it("requires a name", () => {
    expect(validateConnection(sqliteConn({ name: "  " }))).toContain(
      "El nombre es obligatorio.",
    );
  });
  it("requires required fields", () => {
    const errs = validateConnection(sqliteConn({ params: { path: "" } }));
    expect(errs.some((e) => e.includes("Archivo de base de datos"))).toBe(true);
  });
  it("rejects an unknown driver", () => {
    const errs = validateConnection(sqliteConn({ driver: "nope" }));
    expect(errs.some((e) => e.includes("Motor desconocido"))).toBe(true);
  });
  it("treats optional fields as not required (postgres password)", () => {
    expect(validateConnection(pgConn({ params: { host: "h", database: "d", user: "u" } }))).toEqual([]);
  });
});

describe("buildDsn", () => {
  it("includes only non-empty schema fields", () => {
    const dsn = buildDsn(pgConn({ params: { host: "h", port: "", database: "d", user: "u", password: "p" } }));
    expect(dsn).toEqual({ host: "h", database: "d", user: "u", password: "p" });
    expect("port" in dsn).toBe(false);
  });
  it("builds the sqlite path dsn", () => {
    expect(buildDsn(sqliteConn())).toEqual({ path: "/tmp/app.db" });
  });
});

describe("nextConnectionId", () => {
  it("starts at conn-1", () => {
    expect(nextConnectionId([])).toBe("conn-1");
  });
  it("is one past the highest numeric suffix", () => {
    expect(nextConnectionId([sqliteConn({ id: "conn-3" }), sqliteConn({ id: "conn-1" })])).toBe("conn-4");
  });
  it("ignores non-matching ids", () => {
    expect(nextConnectionId([sqliteConn({ id: "weird" })])).toBe("conn-1");
  });
});

describe("upsertConnection / removeConnection", () => {
  it("appends a new connection", () => {
    const list = upsertConnection([], sqliteConn());
    expect(list).toHaveLength(1);
  });
  it("replaces in place by id", () => {
    const list = [sqliteConn(), pgConn()];
    const updated = upsertConnection(list, sqliteConn({ name: "Renamed" }));
    expect(updated).toHaveLength(2);
    expect(updated[0].name).toBe("Renamed");
  });
  it("removes by id", () => {
    expect(removeConnection([sqliteConn(), pgConn()], "conn-1")).toEqual([pgConn()]);
  });
});

describe("serialize / parse round-trip", () => {
  it("strips secrets on serialize", () => {
    const raw = serializeConnections([pgConn()]);
    expect(raw).not.toContain("secret");
    const parsed = parseConnections(raw);
    expect(parsed[0].params).toEqual({ host: "localhost", database: "app", user: "me" });
  });

  it("round-trips a secret-free connection", () => {
    const parsed = parseConnections(serializeConnections([sqliteConn()]));
    expect(parsed).toEqual([sqliteConn()]);
  });

  it("returns [] for null, junk or non-array", () => {
    expect(parseConnections(null)).toEqual([]);
    expect(parseConnections("not json")).toEqual([]);
    expect(parseConnections('{"a":1}')).toEqual([]);
  });

  it("drops malformed entries", () => {
    const raw = JSON.stringify([{ id: "conn-1" }, sqliteConn()]);
    expect(parseConnections(raw)).toEqual([sqliteConn()]);
  });
});

describe("SSH tunnel fields", () => {
  it("are all optional (no required SSH field forces an error)", () => {
    expect(SSH_TUNNEL_FIELDS.every((f) => !f.required)).toBe(true);
  });

  it("are appended after the base fields by withSshTunnel", () => {
    const base: DriverField[] = [
      { key: "host", label: "Host", type: "text", required: true },
    ];
    const merged = withSshTunnel(base);
    expect(merged[0].key).toBe("host");
    expect(merged.slice(1)).toEqual(SSH_TUNNEL_FIELDS);
    // pure: the base array is not mutated
    expect(base).toHaveLength(1);
  });

  it("share the SSH group so the form renders one subheading", () => {
    expect(SSH_TUNNEL_FIELDS.every((f) => f.group === SSH_GROUP)).toBe(true);
  });

  it("model ssh_auth as a select with the three methods plus a blank default", () => {
    const auth = SSH_TUNNEL_FIELDS.find((f) => f.key === "ssh_auth");
    expect(auth?.type).toBe("select");
    expect(auth?.options?.map((o) => o.value)).toEqual(["", "agent", "password", "key"]);
  });

  it("are part of the postgres schema (a network engine)", () => {
    const keys = DRIVER_SCHEMAS.postgres.fields.map((f) => f.key);
    expect(keys).toContain("ssh_host");
    expect(keys).toContain("ssh_user");
  });

  it("are NOT part of sqlite (a local file engine)", () => {
    const keys = DRIVER_SCHEMAS.sqlite.fields.map((f) => f.key);
    expect(keys.some((k) => k.startsWith("ssh_"))).toBe(false);
  });

  it("ssh_password and ssh_key_passphrase are treated as secrets (never persisted)", () => {
    const conn: Connection = {
      id: "conn-9",
      name: "Tunnelled",
      driver: "postgres",
      params: {
        host: "10.0.0.5",
        database: "app",
        user: "me",
        password: "dbpw",
        ssh_host: "bastion",
        ssh_user: "deploy",
        ssh_auth: "password",
        ssh_password: "sshpw",
        ssh_key_passphrase: "phrase",
      },
    };
    const stripped = stripSecrets(conn, DRIVER_SCHEMAS.postgres);
    expect("ssh_password" in stripped.params).toBe(false);
    expect("ssh_key_passphrase" in stripped.params).toBe(false);
    expect(stripped.params.ssh_host).toBe("bastion");
    const raw = serializeConnections([conn]);
    expect(raw).not.toContain("sshpw");
    expect(raw).not.toContain("phrase");
  });

  it("buildDsn emits ssh_* keys only when filled in", () => {
    const direct = buildDsn({
      id: "c",
      name: "n",
      driver: "postgres",
      params: { host: "h", database: "d", user: "u" },
    });
    expect(Object.keys(direct).some((k) => k.startsWith("ssh_"))).toBe(false);

    const tunnelled = buildDsn({
      id: "c",
      name: "n",
      driver: "postgres",
      params: { host: "h", database: "d", user: "u", ssh_host: "bastion", ssh_user: "deploy", ssh_auth: "" },
    });
    expect(tunnelled.ssh_host).toBe("bastion");
    expect(tunnelled.ssh_user).toBe("deploy");
    // a blank select value is omitted, so the core applies its default (agent)
    expect("ssh_auth" in tunnelled).toBe(false);
  });
});

describe("MySQL SSL fields", () => {
  it("are all optional and share the SSL group", () => {
    expect(MYSQL_SSL_FIELDS.every((f) => !f.required)).toBe(true);
    expect(MYSQL_SSL_FIELDS.every((f) => f.group === SSL_GROUP)).toBe(true);
  });

  it("model ssl_mode as a select with the four modes plus a blank default", () => {
    const mode = MYSQL_SSL_FIELDS.find((f) => f.key === "ssl_mode");
    expect(mode?.type).toBe("select");
    expect(mode?.options?.map((o) => o.value)).toEqual([
      "",
      "disabled",
      "required",
      "verify_ca",
      "verify_identity",
    ]);
  });

  it("expose ssl_ca/ssl_cert/ssl_key as file fields", () => {
    for (const k of ["ssl_ca", "ssl_cert", "ssl_key"]) {
      expect(MYSQL_SSL_FIELDS.find((f) => f.key === k)?.type).toBe("file");
    }
  });

  it("the mysql schema carries base, SSL and SSH-tunnel fields", () => {
    const keys = DRIVER_SCHEMAS.mysql.fields.map((f) => f.key);
    expect(keys).toContain("host");
    expect(keys).toContain("ssl_mode");
    expect(keys).toContain("ssh_host");
    expect(DRIVER_SCHEMAS.mysql.driver).toBe("mysql");
  });

  it("buildDsn emits ssl_* keys only when filled in", () => {
    const plain = buildDsn({
      id: "c", name: "n", driver: "mysql",
      params: { host: "h", user: "u" },
    });
    expect(Object.keys(plain).some((k) => k.startsWith("ssl_"))).toBe(false);

    const tls = buildDsn({
      id: "c", name: "n", driver: "mysql",
      params: { host: "h", user: "u", ssl_mode: "required", ssl_ca: "/etc/ca.pem" },
    });
    expect(tls.ssl_mode).toBe("required");
    expect(tls.ssl_ca).toBe("/etc/ca.pem");
  });
});
