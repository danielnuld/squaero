import { describe, it, expect } from "vitest";
import { buildViewApply } from "../../src/utils/viewEdit";

describe("buildViewApply — CREATE OR REPLACE engines", () => {
  it("rewrites CREATE VIEW to CREATE OR REPLACE VIEW for mysql", () => {
    const r = buildViewApply("mysql", "CREATE VIEW `v` AS SELECT 1", "`v`");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.statements).toEqual(["CREATE OR REPLACE VIEW `v` AS SELECT 1"]);
  });
  it("leaves an existing OR REPLACE untouched (postgres)", () => {
    const sql = "CREATE OR REPLACE VIEW v AS SELECT 1";
    const r = buildViewApply("postgres", sql, "v");
    expect(r.ok && r.statements).toEqual([sql]);
  });
  it("strips a trailing semicolon", () => {
    const r = buildViewApply("mysql", "CREATE VIEW v AS SELECT 1;", "v");
    expect(r.ok && r.statements[0].endsWith(";")).toBe(false);
  });
});

describe("buildViewApply — DROP + CREATE engines", () => {
  it("drops then recreates for sqlite, reusing the name from the DDL", () => {
    const r = buildViewApply("sqlite", 'CREATE VIEW "adults" AS SELECT * FROM users', "IGNORED");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.statements[0]).toBe('DROP VIEW IF EXISTS "adults"');
      expect(r.statements[1]).toBe('CREATE VIEW "adults" AS SELECT * FROM users');
    }
  });
  it("uses bare (unquoted) names as they appear for informix", () => {
    const r = buildViewApply("informix", "CREATE VIEW myview AS SELECT * FROM t", "fallback");
    expect(r.ok && r.statements[0]).toBe("DROP VIEW IF EXISTS myview");
  });
  it("falls back to the given name when the DDL name can't be parsed", () => {
    const r = buildViewApply("sqlite", "CREATE VIEW", "fb");
    // still a CREATE … VIEW, so ok; name parse fails -> fallback
    expect(r.ok && r.statements[0]).toBe("DROP VIEW IF EXISTS fb");
  });
});

describe("buildViewApply — rejects non-views", () => {
  it("rejects a non-CREATE-VIEW statement", () => {
    const r = buildViewApply("sqlite", "SELECT * FROM t", "v");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/vista/i);
  });
  it("rejects empty text", () => {
    expect(buildViewApply("mysql", "   ", "v").ok).toBe(false);
  });
});
