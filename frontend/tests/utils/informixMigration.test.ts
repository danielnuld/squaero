import { describe, it, expect } from "vitest";
import {
  INFORMIX_PORT_REVIEW,
  migrateInformixConnection,
  parseConnections,
  serializeConnections,
  type Connection,
} from "../../src/utils/connections";

// Saved Informix connections from the ODBC driver, moved to DRDA (issue #557):
// the usual SQLI port becomes the usual DRDA port, anything else is kept and
// flagged, never guessed.

const old = (params: Record<string, string>): Connection => ({
  id: "c1",
  name: "Nómina",
  driver: "informix",
  params: { host: "sia01", server: "ol_informix1170", database: "nomina", user: "informix", ...params },
});

describe("migrateInformixConnection", () => {
  it("moves the usual SQLI port 9088 to the usual DRDA port 9089", () => {
    const m = migrateInformixConnection(old({ port: "9088" }));
    expect(m.params.port).toBe("9089");
    expect(m.params[INFORMIX_PORT_REVIEW]).toBeUndefined();
  });

  it("fills in 9089 when no port was saved", () => {
    expect(migrateInformixConnection(old({})).params.port).toBe("9089");
    expect(migrateInformixConnection(old({ port: "  " })).params.port).toBe("9089");
  });

  it("keeps any other port and flags it for review", () => {
    const m = migrateInformixConnection(old({ port: "1526" }));
    expect(m.params.port).toBe("1526");
    expect(m.params[INFORMIX_PORT_REVIEW]).toBe("1");
    // A services name is not a DRDA port either: kept, flagged.
    expect(migrateInformixConnection(old({ port: "sqlexec" })).params[INFORMIX_PORT_REVIEW]).toBe("1");
  });

  it("drops the keys only the Client SDK understood", () => {
    const m = migrateInformixConnection(
      old({ port: "9088", client_locale: "en_us.819", db_locale: "en_us.819", protocol: "" }),
    );
    for (const k of ["server", "protocol", "client_locale", "db_locale"]) {
      expect(k in m.params).toBe(false);
    }
    expect(m.params).toMatchObject({ host: "sia01", database: "nomina", user: "informix" });
  });

  it("keeps an onsocssl connection encrypted and verified, and flags its port", () => {
    const m = migrateInformixConnection(old({ port: "9888", protocol: "onsocssl" }));
    expect(m.params.tls).toBe("verify-ca");
    expect(m.params.port).toBe("9888");
    expect(m.params[INFORMIX_PORT_REVIEW]).toBe("1");
  });

  it("leaves a connection made for DRDA alone, and so runs once", () => {
    const fresh: Connection = {
      id: "c2", name: "x", driver: "informix", params: { host: "h", port: "1526", user: "u" },
    };
    expect(migrateInformixConnection(fresh)).toBe(fresh);
    const once = migrateInformixConnection(old({ port: "1526" }));
    expect(migrateInformixConnection(once)).toBe(once);
  });

  it("forces the move for imports from tools that only speak SQLI", () => {
    const imported: Connection = {
      id: "", name: "x", driver: "informix", params: { host: "h", port: "9088", user: "u" },
    };
    expect(migrateInformixConnection(imported, true).params.port).toBe("9089");
  });

  it("does not touch other engines", () => {
    const pg: Connection = { id: "p", name: "pg", driver: "postgres", params: { host: "h", server: "s" } };
    expect(migrateInformixConnection(pg, true)).toBe(pg);
  });
});

describe("stored connections are migrated as they load", () => {
  it("parseConnections hands back the DRDA shape", () => {
    const [c] = parseConnections(serializeConnections([old({ port: "9088" })]));
    expect(c.params.port).toBe("9089");
    expect("server" in c.params).toBe(false);
  });
});
