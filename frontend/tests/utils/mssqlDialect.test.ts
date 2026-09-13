import { describe, it, expect } from "vitest";
import { quoteIdentifier, qualifiedName } from "../../src/utils/schema";
import { previewSelect, objectPreviewQuery, objectCountQuery } from "../../src/utils/pagination";
import { AVAILABLE_DRIVERS, DRIVER_SCHEMAS } from "../../src/utils/connections";

// SQL Server's dialect in the generated statements (issue #49): brackets for
// identifiers, OFFSET … FETCH for paging, which needs an ORDER BY to be legal.

describe("SQL Server identifiers", () => {
  it("brackets a name and doubles a closing bracket", () => {
    expect(quoteIdentifier("tipos", "mssql")).toBe("[tipos]");
    expect(quoteIdentifier("a]b", "mssql")).toBe("[a]]b]");
    expect(quoteIdentifier("a[b", "mssql")).toBe("[a[b]");
  });

  it("qualifies database, schema and object with brackets", () => {
    expect(qualifiedName({ db: "quaero_test", schema: "ventas", name: "tipos" }, "mssql")).toBe(
      "[quaero_test].[ventas].[tipos]",
    );
    expect(qualifiedName({ schema: "dbo", name: "t" }, "mssql")).toBe("[dbo].[t]");
  });
});

describe("SQL Server preview paging", () => {
  it("pages with OFFSET … FETCH, ordering by a constant when no order was chosen", () => {
    expect(previewSelect("[dbo].[t]", "mssql", 100)).toBe(
      "SELECT * FROM [dbo].[t] ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY;",
    );
    expect(previewSelect("[dbo].[t]", "mssql", 100, 200)).toBe(
      "SELECT * FROM [dbo].[t] ORDER BY (SELECT NULL) OFFSET 200 ROWS FETCH NEXT 100 ROWS ONLY;",
    );
  });

  it("keeps a chosen filter and order", () => {
    expect(previewSelect("[dbo].[t]", "mssql", 50, 0, "[id] > 1", "[nombre] DESC")).toBe(
      "SELECT * FROM [dbo].[t] WHERE [id] > 1 ORDER BY [nombre] DESC OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;",
    );
  });

  it("reads the whole object with no paging clause when uncapped", () => {
    expect(previewSelect("[dbo].[t]", "mssql", 0)).toBe("SELECT * FROM [dbo].[t];");
  });

  it("opens and counts an object through the same qualified name", () => {
    const parts = { db: "quaero_test", schema: "ventas", name: "tipos" };
    expect(objectPreviewQuery(parts, "mssql", 10)).toContain("FROM [quaero_test].[ventas].[tipos] ORDER BY");
    expect(objectCountQuery(parts, "mssql")).toBe(
      "SELECT COUNT(*) AS n FROM [quaero_test].[ventas].[tipos];",
    );
  });
});

describe("SQL Server connection form", () => {
  it("is offered, with host and user required and a validated encryption choice", () => {
    expect(AVAILABLE_DRIVERS).toContain("mssql");
    const fields = DRIVER_SCHEMAS.mssql.fields;
    const byKey = (k: string) => fields.find((f) => f.key === k);
    expect(byKey("host")?.required).toBe(true);
    expect(byKey("user")?.required).toBe(true);
    expect(byKey("password")?.type).toBe("password");
    // Exactly the values the driver accepts (empty = its default, require).
    expect(byKey("encryption")?.options?.map((o) => o.value)).toEqual(["", "request", "off", "strict"]);
  });
});
