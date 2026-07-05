import { describe, it, expect } from "vitest";
import { objectsFor, definitionFor, unsupportedReason } from "../../src/utils/triggers";

describe("objectsFor — triggers", () => {
  it("lists MySQL/MariaDB triggers from information_schema scoped to DATABASE()", () => {
    for (const e of ["mysql", "mariadb", "MySQL"]) {
      const s = objectsFor(e, "trigger");
      expect(s.supported).toBe(true);
      expect(s.listSql).toContain("information_schema.TRIGGERS");
      expect(s.listSql).toContain("DATABASE()");
      expect(s.nameCol).toBe("TRIGGER_NAME");
      expect(s.tableCol).toBe("EVENT_OBJECT_TABLE");
      expect(s.inlineDefCol).toBeNull();
    }
  });

  it("scopes MySQL trigger listing to a given database (escaping quotes)", () => {
    const s = objectsFor("mysql", "trigger", "my'db");
    expect(s.listSql).toContain("TRIGGER_SCHEMA = 'my''db'");
  });

  it("lists PostgreSQL triggers from pg_trigger excluding internal ones", () => {
    const s = objectsFor("postgres", "trigger");
    expect(s.supported).toBe(true);
    expect(s.listSql).toContain("pg_trigger");
    expect(s.listSql).toContain("NOT t.tgisinternal");
    expect(s.tableCol).toBe("table");
  });

  it("lists SQLite triggers with the DDL inline from sqlite_master", () => {
    const s = objectsFor("sqlite", "trigger");
    expect(s.supported).toBe(true);
    expect(s.listSql).toContain("sqlite_master");
    expect(s.inlineDefCol).toBe("sql");
  });

  it("lists Informix triggers from systriggers carrying trigid", () => {
    const s = objectsFor("informix", "trigger");
    expect(s.supported).toBe(true);
    expect(s.listSql).toContain("systriggers");
    expect(s.idCol).toBe("trigid");
  });

  it("is unsupported for MongoDB / unknown", () => {
    for (const e of ["mongodb", "weirddb"]) {
      expect(objectsFor(e, "trigger").supported).toBe(false);
    }
  });
});

describe("objectsFor — events", () => {
  it("lists MySQL/MariaDB events from information_schema.EVENTS", () => {
    const s = objectsFor("mysql", "event", "shop");
    expect(s.supported).toBe(true);
    expect(s.listSql).toContain("information_schema.EVENTS");
    expect(s.listSql).toContain("EVENT_SCHEMA = 'shop'");
    expect(s.nameCol).toBe("EVENT_NAME");
  });

  it("is unsupported for non-MySQL engines", () => {
    for (const e of ["postgres", "sqlite", "informix", "mongodb"]) {
      expect(objectsFor(e, "event").supported).toBe(false);
    }
  });
});

describe("definitionFor — triggers", () => {
  it("builds SHOW CREATE TRIGGER for MySQL with backtick-quoted name", () => {
    const d = definitionFor("mysql", "trigger", { name: "trg`x" });
    expect(d!.sql).toBe("SHOW CREATE TRIGGER `trg``x`");
    expect(d!.column).toBe("SQL Original Statement");
    expect(d!.concatRows).toBe(false);
  });

  it("builds pg_get_triggerdef pinned to the table when known", () => {
    const d = definitionFor("postgres", "trigger", { name: "t", table: "orders" });
    expect(d!.sql).toContain("pg_get_triggerdef");
    expect(d!.sql).toContain("t.tgname = 't'");
    expect(d!.sql).toContain("c.relname = 'orders'");
    const d2 = definitionFor("postgres", "trigger", { name: "t" });
    expect(d2!.sql).not.toContain("c.relname =");
  });

  it("looks up SQLite trigger DDL from sqlite_master", () => {
    const d = definitionFor("sqlite", "trigger", { name: "t" });
    expect(d!.sql).toContain("sqlite_master");
    expect(d!.column).toBe("sql");
  });

  it("reassembles Informix trigger definition pinned to trigid, with injection guard", () => {
    const d = definitionFor("informix", "trigger", { name: "t", id: "77" });
    expect(d!.sql).toContain("systrigbody");
    expect(d!.sql).toContain("b.trigid = 77");
    expect(d!.concatRows).toBe(true);
    const bad = definitionFor("informix", "trigger", { name: "t", id: "1; DROP" });
    expect(bad!.sql).toContain("FIRST 1 t.trigid");
    expect(bad!.sql).not.toContain("DROP");
  });
});

describe("definitionFor — events", () => {
  it("builds SHOW CREATE EVENT for MySQL only", () => {
    const d = definitionFor("mariadb", "event", { name: "nightly" });
    expect(d!.sql).toBe("SHOW CREATE EVENT `nightly`");
    expect(d!.column).toBe("Create Event");
    expect(definitionFor("postgres", "event", { name: "nightly" })).toBeNull();
  });

  it("returns null for empty name", () => {
    expect(definitionFor("mysql", "trigger", { name: "  " })).toBeNull();
  });
});

describe("unsupportedReason", () => {
  it("explains per engine and kind", () => {
    expect(unsupportedReason("mongodb", "trigger")).toContain("MongoDB");
    expect(unsupportedReason("postgres", "event")).toContain("pg_cron");
    expect(unsupportedReason("sqlite", "event")).toContain("eventos");
    expect(unsupportedReason("", "trigger")).toContain("desconocido");
  });
});
