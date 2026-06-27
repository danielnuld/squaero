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
  DRIVER_SCHEMAS,
  type Connection,
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
  it("finds the password field for postgres", () => {
    expect(secretFieldKeys(DRIVER_SCHEMAS.postgres)).toEqual(["password"]);
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
