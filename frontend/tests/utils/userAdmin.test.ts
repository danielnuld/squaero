import { describe, it, expect } from "vitest";
import {
  userAdminFor,
  showGrantsSql,
  buildGrantSql,
  buildRevokeSql,
  unsupportedReason,
  MYSQL_PRIVILEGES,
} from "../../src/utils/userAdmin";

describe("userAdminFor", () => {
  it("supports MySQL/MariaDB with a user list", () => {
    for (const e of ["mysql", "mariadb", "MySQL"]) {
      const s = userAdminFor(e);
      expect(s.supported).toBe(true);
      expect(s.listUsersSql).toContain("mysql.user");
      expect(s.userNameCol).toBe("User");
      expect(s.userHostCol).toBe("Host");
    }
  });

  it("is unsupported for sqlite / informix / postgres / mongodb / unknown", () => {
    for (const e of ["sqlite", "informix", "postgres", "mongodb", "weird"]) {
      expect(userAdminFor(e).supported).toBe(false);
    }
  });
});

describe("showGrantsSql", () => {
  it("builds SHOW GRANTS with an escaped user@host", () => {
    expect(showGrantsSql("mysql", "app", "localhost")).toBe("SHOW GRANTS FOR 'app'@'localhost'");
    expect(showGrantsSql("mysql", "o'brien")).toBe("SHOW GRANTS FOR 'o''brien'@'%'");
  });
  it("is null for unsupported engines or empty user", () => {
    expect(showGrantsSql("sqlite", "a")).toBeNull();
    expect(showGrantsSql("mysql", "")).toBeNull();
  });
});

describe("buildGrantSql / buildRevokeSql", () => {
  it("builds a GRANT for the selected privileges, scope and user", () => {
    const sql = buildGrantSql("mysql", {
      privileges: ["SELECT", "INSERT"],
      scope: "shop.*",
      user: "app",
      host: "%",
    });
    expect(sql).toBe("GRANT SELECT, INSERT ON shop.* TO 'app'@'%'");
  });

  it("collapses ALL PRIVILEGES to itself", () => {
    const sql = buildGrantSql("mysql", {
      privileges: ["SELECT", "ALL PRIVILEGES"],
      scope: "*.*",
      user: "root",
      host: "localhost",
    });
    expect(sql).toBe("GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost'");
  });

  it("builds a REVOKE with FROM", () => {
    expect(
      buildRevokeSql("mysql", { privileges: ["DELETE"], scope: "shop.orders", user: "app" }),
    ).toBe("REVOKE DELETE ON shop.orders FROM 'app'@'%'");
  });

  it("returns null when the form is incomplete or engine unsupported", () => {
    expect(buildGrantSql("mysql", { privileges: [], scope: "*.*", user: "a" })).toBeNull();
    expect(buildGrantSql("mysql", { privileges: ["SELECT"], scope: "", user: "a" })).toBeNull();
    expect(buildGrantSql("mysql", { privileges: ["SELECT"], scope: "*.*", user: "" })).toBeNull();
    expect(buildGrantSql("postgres", { privileges: ["SELECT"], scope: "*.*", user: "a" })).toBeNull();
  });

  it("exposes a non-empty privilege catalog", () => {
    expect(MYSQL_PRIVILEGES).toContain("SELECT");
    expect(MYSQL_PRIVILEGES).toContain("ALL PRIVILEGES");
  });
});

describe("unsupportedReason", () => {
  it("explains per engine", () => {
    expect(unsupportedReason("sqlite")).toContain("embebida");
    expect(unsupportedReason("informix")).toContain("Informix");
    expect(unsupportedReason("postgres")).toContain("PostgreSQL");
    expect(unsupportedReason("mongodb")).toContain("MongoDB");
  });
});
