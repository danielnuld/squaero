import { describe, it, expect } from "vitest";
import { engineFamily } from "../../src/utils/engineFamily";

describe("engineFamily", () => {
  it("collapses MySQL / MariaDB to mysql", () => {
    expect(engineFamily("mysql")).toBe("mysql");
    expect(engineFamily("mariadb")).toBe("mysql");
    expect(engineFamily("MariaDB")).toBe("mysql");
  });

  it("collapses postgres / postgresql to postgres", () => {
    expect(engineFamily("postgres")).toBe("postgres");
    expect(engineFamily("postgresql")).toBe("postgres");
    expect(engineFamily("PostgreSQL")).toBe("postgres");
  });

  it("passes other engines through lower-cased", () => {
    expect(engineFamily("SQLite")).toBe("sqlite");
    expect(engineFamily("Informix")).toBe("informix");
    expect(engineFamily("MongoDB")).toBe("mongodb");
  });

  it("is null/empty safe", () => {
    expect(engineFamily("")).toBe("");
    expect(engineFamily(undefined as unknown as string)).toBe("");
  });
});
