import { describe, it, expect } from "vitest";
import {
  driverSchema,
  secretFieldKeys,
  stripSecrets,
  validateConnection,
  fieldErrors,
  isValid,
  engineIcon,
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
  AVAILABLE_DRIVERS,
  dsnForDatabaseList,
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

describe("engineIcon", () => {
  it("gives a distinct icon for known engines", () => {
    const icons = new Set(["sqlite", "mysql", "postgres", "mongodb"].map(engineIcon));
    expect(icons.size).toBe(4);
  });
  it("is case-insensitive and falls back for unknown engines", () => {
    expect(engineIcon("MySQL")).toBe(engineIcon("mysql"));
    expect(typeof engineIcon("something")).toBe("string");
    expect(engineIcon("something")).not.toBe("");
  });
});

describe("fieldErrors / isValid", () => {
  it("is clean for a valid connection", () => {
    const e = fieldErrors(pgConn({ params: { host: "h", database: "d", user: "u" } }));
    expect(e.name).toBeNull();
    expect(e.params).toEqual({});
    expect(isValid(e)).toBe(true);
  });
  it("flags a missing name", () => {
    expect(fieldErrors(sqliteConn({ name: "  " })).name).toMatch(/obligatorio/i);
  });
  it("flags a missing required field by key", () => {
    const e = fieldErrors(sqliteConn({ params: { path: "" } }));
    expect(e.params.path).toBeDefined();
    expect(isValid(e)).toBe(false);
  });
  it("flags a non-numeric value in a number field", () => {
    const e = fieldErrors(
      pgConn({ params: { host: "h", database: "d", user: "u", port: "abc" } }),
    );
    expect(e.params.port).toMatch(/número/i);
  });
  it("accepts a numeric value and blank optional number field", () => {
    expect(
      fieldErrors(pgConn({ params: { host: "h", database: "d", user: "u", port: "5432" } })).params
        .port,
    ).toBeUndefined();
    expect(
      fieldErrors(pgConn({ params: { host: "h", database: "d", user: "u", port: "" } })).params.port,
    ).toBeUndefined();
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

describe("dsnForDatabaseList", () => {
  const ifx = (over: Partial<Connection["params"]> = {}): Connection => ({
    id: "c",
    name: "IFX",
    driver: "informix",
    params: { host: "h", port: "1526", server: "ol", user: "informix", ...over },
  });
  const my = (over: Partial<Connection["params"]> = {}): Connection => ({
    id: "c",
    name: "MY",
    driver: "mysql",
    params: { host: "h", user: "root", ...over },
  });

  it("uses sysmaster for Informix when no database is set (it needs one)", () => {
    expect(dsnForDatabaseList(ifx()).database).toBe("sysmaster");
  });
  it("keeps the typed Informix database when present", () => {
    expect(dsnForDatabaseList(ifx({ database: "stores" })).database).toBe("stores");
  });
  it("omits the database for other engines when blank (connect to the server)", () => {
    const dsn = dsnForDatabaseList(my());
    expect("database" in dsn).toBe(false);
  });
  it("keeps the typed database for other engines", () => {
    expect(dsnForDatabaseList(my({ database: "app" })).database).toBe("app");
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
  it("persists passwords (round-trips secrets) so reconnecting needs no re-typing", () => {
    const raw = serializeConnections([pgConn()]);
    expect(raw).toContain("secret");
    const parsed = parseConnections(raw);
    expect(parsed[0].params).toEqual({
      host: "localhost",
      database: "app",
      user: "me",
      password: "secret",
    });
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

  it("round-trips the accent color and ignores a non-string one", () => {
    const colored = { ...sqliteConn(), color: "#e5484d" };
    expect(parseConnections(serializeConnections([colored]))).toEqual([colored]);
    // A non-string / empty color is dropped rather than carried through.
    const raw = JSON.stringify([{ ...sqliteConn(), color: 123 }, { ...pgConn(), color: "" }]);
    const parsed = parseConnections(raw);
    expect(parsed[0].color).toBeUndefined();
    expect(parsed[1].color).toBeUndefined();
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

  it("stripSecrets removes ssh secrets, but serialize persists them (password-save)", () => {
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
    // stripSecrets still drops secrets for callers that want a secret-free copy.
    const stripped = stripSecrets(conn, DRIVER_SCHEMAS.postgres);
    expect("ssh_password" in stripped.params).toBe(false);
    expect("ssh_key_passphrase" in stripped.params).toBe(false);
    expect(stripped.params.ssh_host).toBe("bastion");
    // Storage now persists passwords (incl. ssh secrets) for reconnect convenience.
    const raw = serializeConnections([conn]);
    expect(raw).toContain("sshpw");
    expect(raw).toContain("phrase");
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

describe("Informix schema", () => {
  it("carries the direct-connection fields plus the SSH-tunnel group", () => {
    const keys = DRIVER_SCHEMAS.informix.fields.map((f) => f.key);
    expect(keys).toContain("host");
    expect(keys).toContain("port");
    expect(keys).toContain("server");
    expect(keys).toContain("database");
    expect(keys).toContain("user");
    expect(keys).toContain("password");
    expect(keys).toContain("ssh_host");
    expect(DRIVER_SCHEMAS.informix.driver).toBe("informix");
  });

  it("requires host, port (service) and server", () => {
    const errors = validateConnection({
      id: "c", name: "ifx", driver: "informix", params: {},
    });
    expect(errors).toContain('El campo "Host" es obligatorio.');
    expect(errors).toContain('El campo "Puerto / servicio" es obligatorio.');
    expect(errors).toContain('El campo "Servidor (INFORMIXSERVER)" es obligatorio.');
  });

  it("models port/service as free text so a services name is allowed", () => {
    const port = DRIVER_SCHEMAS.informix.fields.find((f) => f.key === "port");
    expect(port?.type).toBe("text");
  });

  it("buildDsn passes the direct-connection fields through, omitting blanks", () => {
    const dsn = buildDsn({
      id: "c", name: "ifx", driver: "informix",
      params: { host: "10.0.0.5", port: "1526", server: "ol_inf", user: "informix" },
    });
    expect(dsn).toEqual({
      host: "10.0.0.5", port: "1526", server: "ol_inf", user: "informix",
    });
    expect("database" in dsn).toBe(false);
    expect("password" in dsn).toBe(false);
  });

  it("treats the password as a secret stripped from storage", () => {
    expect(secretFieldKeys(DRIVER_SCHEMAS.informix)).toContain("password");
  });
});

describe("MongoDB schema", () => {
  it("carries the direct-connection fields plus the SSH-tunnel group", () => {
    const keys = DRIVER_SCHEMAS.mongodb.fields.map((f) => f.key);
    expect(keys).toContain("host");
    expect(keys).toContain("port");
    expect(keys).toContain("database");
    expect(keys).toContain("user");
    expect(keys).toContain("password");
    expect(keys).toContain("auth_source");
    expect(keys).toContain("tls");
    expect(keys).toContain("ssh_host");
    expect(DRIVER_SCHEMAS.mongodb.driver).toBe("mongodb");
  });

  it("requires host and database", () => {
    const errors = validateConnection({
      id: "c", name: "mongo", driver: "mongodb", params: {},
    });
    expect(errors).toContain('El campo "Host" es obligatorio.');
    expect(errors).toContain('El campo "Base de datos" es obligatorio.');
  });

  it("treats the password as a secret stripped from storage", () => {
    expect(secretFieldKeys(DRIVER_SCHEMAS.mongodb)).toContain("password");
  });
});

describe("AVAILABLE_DRIVERS", () => {
  it("offers sqlite, postgres, mysql, informix and mongodb, each with a schema", () => {
    expect(AVAILABLE_DRIVERS).toEqual(["sqlite", "postgres", "mysql", "informix", "mongodb"]);
    for (const d of AVAILABLE_DRIVERS) {
      expect(driverSchema(d)).toBeDefined();
    }
  });

  it("defaults to sqlite (the first offered driver)", () => {
    expect(AVAILABLE_DRIVERS[0]).toBe("sqlite");
  });
});
