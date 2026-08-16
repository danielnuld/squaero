import { describe, it, expect } from "vitest";
import {
  objectFolders,
  folderSpec,
  objectLeaves,
  readDefinitionText,
  filterObjectRows,
} from "../../src/utils/treeObjects";
import { translate } from "../../src/utils/i18n";

describe("objectFolders", () => {
  it("gives MySQL Procedimientos/Funciones/Triggers/Eventos", () => {
    const f = objectFolders("mysql", "shop");
    expect(f.map((x) => x.groupKind)).toEqual(["procedure", "function", "trigger", "event"]);
    // Routine folders share the routines listing SQL, filtered by type.
    expect(f[0].filterType).toBe("PROCEDURE");
    expect(f[1].filterType).toBe("FUNCTION");
    expect(f[0].listSql).toContain("information_schema.ROUTINES");
    expect(f[2].listSql).toContain("information_schema.TRIGGERS");
    expect(f[3].listSql).toContain("information_schema.EVENTS");
  });

  it("gives SQLite only a Triggers folder", () => {
    const f = objectFolders("sqlite");
    expect(f.map((x) => x.groupKind)).toEqual(["trigger"]);
    expect(f[0].listSql).toContain("sqlite_master");
  });

  it("gives Informix Procedimientos/Funciones/Triggers (no events)", () => {
    const f = objectFolders("informix");
    expect(f.map((x) => x.groupKind)).toEqual(["procedure", "function", "trigger"]);
  });

  it("omits routine/trigger folders for PostgreSQL (per-schema scope) and unknowns", () => {
    expect(objectFolders("postgres")).toEqual([]);
    expect(objectFolders("mongodb")).toEqual([]);
  });
});

describe("folderSpec", () => {
  it("finds a specific folder by group kind", () => {
    // .label is an i18n key; resolve through the es catalog to assert the text.
    expect(translate("es", folderSpec("mysql", "shop", "function")!.label)).toBe("Funciones");
    expect(folderSpec("sqlite", undefined, "procedure")).toBeNull();
  });
});

describe("objectLeaves", () => {
  const routineCols = ["ROUTINE_NAME", "ROUTINE_TYPE", "DATA_TYPE"];
  const routineRows = [
    ["add_user", "PROCEDURE", null],
    ["tax_rate", "FUNCTION", "decimal"],
    ["purge", "PROCEDURE", null],
  ];

  it("filters routines to the folder's type and carries the name", () => {
    const proc = folderSpec("mysql", "s", "procedure")!;
    const leaves = objectLeaves(proc, routineCols, routineRows);
    expect(leaves.map((l) => l.name)).toEqual(["add_user", "purge"]);
    expect(leaves.every((l) => l.groupKind === "procedure")).toBe(true);
    expect(leaves[0].type).toBe("PROCEDURE");
  });

  it("keeps only functions for the Funciones folder", () => {
    const fn = folderSpec("mysql", "s", "function")!;
    expect(objectLeaves(fn, routineCols, routineRows).map((l) => l.name)).toEqual(["tax_rate"]);
  });

  it("carries table/id for trigger leaves without a type filter", () => {
    // Informix trigger listing exposes trigid + name.
    const spec = folderSpec("informix", undefined, "trigger")!;
    const leaves = objectLeaves(spec, ["trigid", "name", "tabid"], [["77", "trg_x", "5"]]);
    expect(leaves[0]).toMatchObject({ name: "trg_x", groupKind: "trigger", id: "77" });
  });

  it("captures the inline DDL for SQLite triggers (no definition query needed)", () => {
    const spec = folderSpec("sqlite", undefined, "trigger")!;
    expect(spec.inlineDefCol).toBe("sql");
    const leaves = objectLeaves(
      spec,
      ["name", "table", "sql"],
      [["trg_x", "t", "CREATE TRIGGER trg_x AFTER INSERT ON t BEGIN SELECT 1; END"]],
    );
    expect(leaves[0].def).toContain("CREATE TRIGGER trg_x");
  });

  it("skips rows with an empty name and unknown name column", () => {
    const proc = folderSpec("mysql", "s", "procedure")!;
    expect(objectLeaves(proc, routineCols, [[null, "PROCEDURE", null]])).toEqual([]);
    expect(objectLeaves(proc, ["other"], [["x"]])).toEqual([]);
  });
});

describe("readDefinitionText", () => {
  it("reads the named column of the first row", () => {
    expect(
      readDefinitionText(["a", "Create Procedure"], [["p", "CREATE PROCEDURE p ..."]], "Create Procedure", false),
    ).toBe("CREATE PROCEDURE p ...");
  });

  it("concatenates all rows in order for multi-row bodies", () => {
    expect(
      readDefinitionText(["data"], [["CREATE "], ["PROC "], ["p;"]], "data", true),
    ).toBe("CREATE PROC p;");
  });

  it("falls back to the first column when the name isn't found", () => {
    expect(readDefinitionText(["only"], [["x"]], "missing", false)).toBe("x");
  });
});

// The search box the routine and trigger explorers grew (#376).
describe("filterObjectRows", () => {
  const rows = [
    ["sp_factura_alta", "PROCEDURE"],
    ["sp_factura_baja", "PROCEDURE"],
    ["fn_total", "FUNCTION"],
    [null, "FUNCTION"],
  ];

  it("keeps the rows whose name contains the query, ignoring case", () => {
    expect(filterObjectRows(rows, [0], "FACTURA").map((r) => r[0])).toEqual([
      "sp_factura_alta",
      "sp_factura_baja",
    ]);
    expect(filterObjectRows(rows, [0], "total").map((r) => r[0])).toEqual(["fn_total"]);
  });

  it("matches anywhere in the name, not just at the start", () => {
    expect(filterObjectRows(rows, [0], "_baja").map((r) => r[0])).toEqual(["sp_factura_baja"]);
  });

  it("keeps everything for an empty or whitespace query", () => {
    expect(filterObjectRows(rows, [0], "")).toHaveLength(4);
    expect(filterObjectRows(rows, [0], "   ")).toHaveLength(4);
  });

  it("drops a nameless row rather than crashing on it", () => {
    expect(filterObjectRows(rows, [0], "f").map((r) => r[0])).toEqual([
      "sp_factura_alta",
      "sp_factura_baja",
      "fn_total",
    ]);
  });

  it("keeps the list untouched when the catalog has no usable column", () => {
    expect(filterObjectRows(rows, [-1], "factura")).toHaveLength(4);
  });

  it("matches any of the given columns, so a trigger is findable by its table", () => {
    const triggers = [
      ["trg_alta", "facturas"],
      ["trg_baja", "clientes"],
    ];
    expect(filterObjectRows(triggers, [0, 1], "facturas").map((r) => r[0])).toEqual(["trg_alta"]);
    expect(filterObjectRows(triggers, [0, 1], "trg_baja").map((r) => r[0])).toEqual(["trg_baja"]);
    // A column the catalog does not have is skipped, not treated as a miss.
    expect(filterObjectRows(triggers, [0, -1], "facturas")).toEqual([]);
  });
});
