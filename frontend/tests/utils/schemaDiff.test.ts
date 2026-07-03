import { describe, it, expect } from "vitest";
import {
  parseStructure,
  diffColumns,
  columnDiffEmpty,
  diffTableLists,
  generateCreateTable,
  generateColumnMigration,
  buildSchemaSync,
  isExecutable,
  type ColumnDef,
  type SchemaEndpoint,
} from "../../src/utils/schemaDiff";
import type { ResultSet } from "../../src/utils/query";

function describe_(rows: (string | null)[][]): ResultSet {
  return {
    columns: [
      { name: "name", type: "text" },
      { name: "type", type: "text" },
      { name: "notnull", type: "int" },
      { name: "dflt_value", type: "text" },
      { name: "pk", type: "int" },
    ],
    rows,
    truncated: false,
    rowsAffected: 0,
  };
}

describe("parseStructure", () => {
  it("reads columns with notnull/pk flags", () => {
    const s = parseStructure(
      describe_([
        ["id", "INTEGER", "1", null, "1"],
        ["name", "TEXT", "0", null, "0"],
      ]),
    );
    expect(s).toEqual([
      { name: "id", type: "INTEGER", notnull: true, pk: true },
      { name: "name", type: "TEXT", notnull: false, pk: false },
    ]);
  });
});

describe("diffColumns", () => {
  const source: ColumnDef[] = [
    { name: "id", type: "INTEGER", notnull: true, pk: true },
    { name: "name", type: "TEXT", notnull: false, pk: false },
    { name: "email", type: "TEXT", notnull: false, pk: false },
  ];
  const target: ColumnDef[] = [
    { name: "id", type: "INTEGER", notnull: true, pk: true },
    { name: "name", type: "VARCHAR(50)", notnull: false, pk: false },
    { name: "legacy", type: "TEXT", notnull: false, pk: false },
  ];

  it("classifies added, removed and type-changed columns", () => {
    const d = diffColumns(source, target);
    expect(d.added.map((c) => c.name)).toEqual(["email"]);
    expect(d.removed.map((c) => c.name)).toEqual(["legacy"]);
    expect(d.changed).toEqual([{ name: "name", from: "VARCHAR(50)", to: "TEXT" }]);
  });

  it("is empty when structures match", () => {
    expect(columnDiffEmpty(diffColumns(source, source))).toBe(true);
  });
});

describe("diffTableLists", () => {
  it("splits into only-source, only-target and common", () => {
    expect(diffTableLists(["a", "b", "c"], ["b", "c", "d"])).toEqual({
      onlyInSource: ["a"],
      onlyInTarget: ["d"],
      common: ["b", "c"],
    });
  });
});

describe("generateCreateTable", () => {
  it("emits a CREATE with NOT NULL and a PRIMARY KEY clause", () => {
    const cols: ColumnDef[] = [
      { name: "id", type: "INTEGER", notnull: true, pk: true },
      { name: "name", type: "TEXT", notnull: false, pk: false },
    ];
    expect(generateCreateTable("users", cols)).toBe(
      'CREATE TABLE "users" (\n' +
        '  "id" INTEGER NOT NULL,\n' +
        '  "name" TEXT,\n' +
        '  PRIMARY KEY ("id")\n' +
        ");",
    );
  });
});

describe("generateColumnMigration", () => {
  it("emits ADD/DROP and a note for a type change", () => {
    const diff = {
      added: [{ name: "email", type: "TEXT", notnull: true, pk: false }],
      removed: [{ name: "legacy", type: "TEXT", notnull: false, pk: false }],
      changed: [{ name: "name", from: "VARCHAR(50)", to: "TEXT" }],
    };
    const sql = generateColumnMigration("users", diff);
    expect(sql[0]).toBe('ALTER TABLE "users" ADD COLUMN "email" TEXT NOT NULL;');
    expect(sql[1]).toBe('ALTER TABLE "users" DROP COLUMN "legacy";');
    expect(sql[2]).toContain("VARCHAR(50) -> TEXT");
    expect(sql[2].startsWith("--")).toBe(true);
  });
});

describe("buildSchemaSync", () => {
  // source has users(+email) and a new table `orders`; target has users(legacy)
  // and an extra table `audit`.
  const structures: Record<string, Record<string, ColumnDef[]>> = {
    source: {
      users: [
        { name: "id", type: "INTEGER", notnull: true, pk: true },
        { name: "email", type: "TEXT", notnull: false, pk: false },
      ],
      orders: [{ name: "id", type: "INTEGER", notnull: true, pk: true }],
    },
    target: {
      users: [
        { name: "id", type: "INTEGER", notnull: true, pk: true },
        { name: "legacy", type: "TEXT", notnull: false, pk: false },
      ],
      audit: [{ name: "id", type: "INTEGER", notnull: true, pk: true }],
    },
  };
  const endpoint = (side: "source" | "target"): SchemaEndpoint => ({
    tables: async () => Object.keys(structures[side]),
    structure: async (t) => structures[side][t] ?? [],
  });

  it("creates source-only tables, alters common ones, notes target-only ones", async () => {
    const { statements, tableDiff } = await buildSchemaSync(
      endpoint("source"),
      endpoint("target"),
    );
    expect(tableDiff.onlyInSource).toEqual(["orders"]);
    expect(tableDiff.onlyInTarget).toEqual(["audit"]);

    const joined = statements.join("\n");
    expect(joined).toContain('CREATE TABLE "orders"');
    expect(joined).toContain('ALTER TABLE "users" ADD COLUMN "email"');
    expect(joined).toContain('ALTER TABLE "users" DROP COLUMN "legacy"');
    expect(joined).toContain("audit existe en destino pero no en origen");
  });

  it("distinguishes executable statements from comment notes", () => {
    expect(isExecutable('CREATE TABLE "x" ()')).toBe(true);
    expect(isExecutable("-- nota")).toBe(false);
  });
});
