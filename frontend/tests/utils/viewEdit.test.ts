import { describe, it, expect } from "vitest";
import { buildViewApply, runnableViewDdl } from "../../src/utils/viewEdit";

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
  it("inserts OR REPLACE after CREATE when clauses sit between CREATE and VIEW (real SHOW CREATE VIEW)", () => {
    // MySQL emits ALGORITHM/DEFINER/SQL SECURITY between CREATE and VIEW; the old
    // "CREATE VIEW" adjacency match missed it and the view was recreated as-is.
    const ddl =
      "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER " +
      "VIEW `active_customer_orders` AS select `c`.`name` from `customers` `c`";
    const r = buildViewApply("mysql", ddl, "`active_customer_orders`");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.statements).toHaveLength(1);
      expect(r.statements[0]).toBe(
        "CREATE OR REPLACE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER " +
          "VIEW `active_customer_orders` AS select `c`.`name` from `customers` `c`",
      );
    }
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

describe("runnableViewDdl", () => {
  it("shows a MySQL view in the form that can be run again", () => {
    // What the engine returns cannot be re-executed: 1050 already exists.
    const raw = "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v` AS select 1";
    expect(runnableViewDdl("mysql", raw, "`v`")).toBe(
      "CREATE OR REPLACE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v` AS select 1;",
    );
  });

  it("shows both statements where the engine has no OR REPLACE", () => {
    expect(runnableViewDdl("sqlite", "CREATE VIEW v AS SELECT 1", "v")).toBe(
      "DROP VIEW IF EXISTS v;\n\nCREATE VIEW v AS SELECT 1;",
    );
  });

  it("round-trips: what is shown applies cleanly", () => {
    // The draft comes back carrying the drop; applying it must not stack a
    // second one, nor read as "not a view definition".
    const shown = runnableViewDdl("informix", "CREATE VIEW v AS SELECT 1", "v");
    const plan = buildViewApply("informix", shown, "v");
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.statements).toEqual(["DROP VIEW IF EXISTS v", "CREATE VIEW v AS SELECT 1"]);
  });

  it("is idempotent on the engines that rewrite in place", () => {
    const once = runnableViewDdl("postgres", "CREATE VIEW v AS SELECT 1", "v");
    expect(runnableViewDdl("postgres", once, "v")).toBe(once);
  });

  it("leaves text that is not a view definition alone", () => {
    expect(runnableViewDdl("mysql", "SELECT 1", "v")).toBe("SELECT 1");
  });
});
