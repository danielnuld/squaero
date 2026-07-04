import { describe, it, expect } from "vitest";
import { useDatabaseSql } from "../../src/utils/dbContext";

describe("useDatabaseSql", () => {
  it("emits USE for MySQL/MariaDB with backtick quoting", () => {
    expect(useDatabaseSql("mysql", "shop")).toBe("USE `shop`");
    expect(useDatabaseSql("mariadb", "my`db")).toBe("USE `my``db`");
  });

  it("is null for engines that cannot switch mid-session", () => {
    expect(useDatabaseSql("sqlite", "main")).toBeNull();
    expect(useDatabaseSql("mongodb", "test")).toBeNull();
    expect(useDatabaseSql("informix", "stores")).toBeNull();
    expect(useDatabaseSql("postgres", "app")).toBeNull();
  });

  it("is null for an empty database name", () => {
    expect(useDatabaseSql("mysql", "  ")).toBeNull();
  });
});
