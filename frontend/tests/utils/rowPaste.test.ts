import { describe, it, expect } from "vitest";
import {
  PASTE_ROW_LIMIT,
  findConflicts,
  planPaste,
  sameSource,
  type RowClipboard,
  type PasteTarget,
  type RowSource,
} from "../../src/utils/rowPaste";

const clientes: RowSource = { connDefId: "c1", db: "ventas", table: "clientes" };
const target: PasteTarget = {
  columns: ["id", "nombre", "email", "saldo"],
  source: clientes,
};
const opts = { emptyAsNull: true };

const copyOf = (
  columns: string[],
  rows: (string | null)[][],
  source: RowSource | null = clientes,
): RowClipboard => ({
  text: rows.map((r) => r.map((c) => c ?? "").join("\t")).join("\n"),
  columns,
  rows,
  source,
});

describe("sameSource", () => {
  it("is the same table on the same saved connection", () => {
    expect(sameSource({ ...clientes }, clientes)).toBe(true);
  });

  it("differs by connection, database, schema or table", () => {
    expect(sameSource({ ...clientes, connDefId: "c2" }, clientes)).toBe(false);
    expect(sameSource({ ...clientes, db: "ventas_dev" }, clientes)).toBe(false);
    expect(sameSource({ ...clientes, schema: "public" }, clientes)).toBe(false);
    expect(sameSource({ ...clientes, table: "prospectos" }, clientes)).toBe(false);
  });

  it("treats an absent database or schema as empty", () => {
    const a: RowSource = { connDefId: "c1", table: "t" };
    expect(sameSource(a, { connDefId: "c1", db: "", schema: "", table: "t" })).toBe(true);
  });

  it("is never the same as an unknown source", () => {
    expect(sameSource(null, clientes)).toBe(false);
  });
});

describe("planPaste — an exact copy made in the app", () => {
  it("places values by column name and keeps NULL apart from empty", () => {
    const clip = copyOf(["id", "nombre", "email", "saldo"], [["3", "Ana", "", null]]);
    expect(planPaste(clip.text, clip, target, opts)).toEqual({
      kind: "inserts",
      rows: [{ id: "3", nombre: "Ana", email: "", saldo: null }],
      ignoredColumns: [],
      pkMode: "generate",
      fromText: false,
    });
  });

  it("keeps a tab or a newline inside a value intact", () => {
    const clip = copyOf(["id", "nombre"], [["1", "a\tb\nc"]]);
    const plan = planPaste(clip.text, clip, target, opts);
    expect(plan.kind === "inserts" && plan.rows[0].nombre).toBe("a\tb\nc");
  });

  it("does not turn empty strings into NULL, whatever the option says", () => {
    const clip = copyOf(["nombre"], [[""]]);
    const plan = planPaste(clip.text, clip, target, { emptyAsNull: true });
    expect(plan.kind === "inserts" && plan.rows[0].nombre).toBe("");
  });

  it("matches column names without regard to case, landing on the target's spelling", () => {
    const clip = copyOf(["ID", "Nombre"], [["1", "Ana"]]);
    const plan = planPaste(clip.text, clip, target, opts);
    expect(plan.kind === "inserts" && plan.rows[0]).toEqual({ id: "1", nombre: "Ana" });
  });

  it("reports copied columns the target lacks and leaves out the ones the copy lacks", () => {
    const prospectos: PasteTarget = {
      columns: ["id", "nombre", "email", "origen"],
      source: { connDefId: "c1", db: "ventas", table: "prospectos" },
    };
    const clip = copyOf(["id", "nombre", "ciudad"], [["1", "Ana", "Guaymas"]]);
    expect(planPaste(clip.text, clip, prospectos, opts)).toEqual({
      kind: "inserts",
      rows: [{ id: "1", nombre: "Ana" }],
      ignoredColumns: ["ciudad"],
      pkMode: "keep",
      fromText: false,
    });
  });

  it("keeps the key when the rows come from another connection's table of the same name", () => {
    const clip = copyOf(["id"], [["1"]], { ...clientes, connDefId: "prod" });
    const plan = planPaste(clip.text, clip, target, opts);
    expect(plan.kind === "inserts" && plan.pkMode).toBe("keep");
  });

  it("sends a copy with no column in common to the wizard", () => {
    const clip = copyOf(["sku", "precio"], [["A1", "10"]]);
    expect(planPaste(clip.text, clip, target, opts)).toEqual({ kind: "wizard", reason: "shape" });
  });

  it("sends more rows than the limit to the wizard", () => {
    const rows = Array.from({ length: PASTE_ROW_LIMIT + 1 }, (_, i) => [String(i)]);
    const clip = copyOf(["id"], rows);
    expect(planPaste(clip.text, clip, target, opts)).toEqual({ kind: "wizard", reason: "tooMany" });
  });

  it("accepts exactly the limit", () => {
    const rows = Array.from({ length: PASTE_ROW_LIMIT }, (_, i) => [String(i)]);
    const clip = copyOf(["id"], rows);
    expect(planPaste(clip.text, clip, target, opts).kind).toBe("inserts");
  });

  it("uses the text instead once the clipboard holds something else", () => {
    const clip = copyOf(["id", "nombre"], [["1", "Ana"]]);
    expect(planPaste("Hermosillo", clip, target, opts)).toEqual({ kind: "none" });
  });
});

describe("planPaste — text from another program", () => {
  it("leaves a single value alone", () => {
    expect(planPaste("Hermosillo", null, target, opts)).toEqual({ kind: "none" });
  });

  it("places lines by position when no line is a header", () => {
    const text = "7\tLuis\t\t12.5\n8\tSofía\ts@x.mx\t";
    expect(planPaste(text, null, target, opts)).toEqual({
      kind: "inserts",
      rows: [
        { id: "7", nombre: "Luis", email: null, saldo: "12.5" },
        { id: "8", nombre: "Sofía", email: "s@x.mx", saldo: null },
      ],
      ignoredColumns: [],
      pkMode: "keep",
      fromText: true,
    });
  });

  it("keeps empty cells as empty strings when asked to", () => {
    const plan = planPaste("7\tLuis\t\t1", null, target, { emptyAsNull: false });
    expect(plan.kind === "inserts" && plan.rows[0].email).toBe("");
  });

  it("uses a first line naming every column as the header, in any order", () => {
    const text = "Saldo\tid\temail\tnombre\n5\t9\ta@x.mx\tAna";
    const plan = planPaste(text, null, target, opts);
    expect(plan.kind === "inserts" && plan.rows).toEqual([
      { saldo: "5", id: "9", email: "a@x.mx", nombre: "Ana" },
    ]);
  });

  it("ignores a trailing newline", () => {
    const plan = planPaste("1\tA\ta@x\t2\n", null, target, opts);
    expect(plan.kind === "inserts" && plan.rows.length).toBe(1);
  });

  it("sends a different number of columns to the wizard", () => {
    expect(planPaste("1\tAna\n2\tLuis", null, target, opts)).toEqual({
      kind: "wizard",
      reason: "shape",
    });
  });

  it("sends a ragged paste to the wizard", () => {
    expect(planPaste("1\tA\ta@x\t2\n2\tB", null, target, opts)).toEqual({
      kind: "wizard",
      reason: "shape",
    });
  });

  it("has nothing to insert from a header on its own", () => {
    expect(planPaste("id\tnombre\temail\tsaldo\n", null, target, opts)).toEqual({ kind: "none" });
  });

  it("sends more rows than the limit to the wizard", () => {
    const text = Array.from({ length: PASTE_ROW_LIMIT + 1 }, (_, i) => `${i}\ta\tb\tc`).join("\n");
    expect(planPaste(text, null, target, opts)).toEqual({ kind: "wizard", reason: "tooMany" });
  });
});

describe("findConflicts", () => {
  const loaded = {
    columns: ["id", "nombre", "email"],
    rows: [
      ["1", "Ana", "ana@x.mx"],
      ["2", "Luis", null],
    ],
  };
  const keep = () => "keep" as const;
  const generate = () => "generate" as const;

  it("flags a kept key that a loaded row already has", () => {
    const got = findConflicts([{ id: "1", nombre: "Otra" }], loaded, { pk: ["id"], uniqueSets: [] }, keep);
    expect([...got]).toEqual([[0, ["id"]]]);
  });

  it("does not check the key of a batch that generates it", () => {
    const got = findConflicts([{ id: "1", nombre: "Otra" }], loaded, { pk: ["id"], uniqueSets: [] }, generate);
    expect(got.size).toBe(0);
  });

  it("flags two pending rows keeping the same key", () => {
    const got = findConflicts([{ id: "9" }, { id: "9" }], loaded, { pk: ["id"], uniqueSets: [] }, keep);
    expect([...got.keys()]).toEqual([0, 1]);
  });

  it("flags a unique column against loaded rows, matching column names without case", () => {
    const got = findConflicts(
      [{ id: "9", email: "ana@x.mx" }],
      loaded,
      { pk: ["id"], uniqueSets: [["EMAIL"]] },
      generate,
    );
    expect([...got]).toEqual([[0, ["EMAIL"]]]);
  });

  it("gathers every colliding column of a row once", () => {
    const got = findConflicts(
      [{ id: "1", email: "ana@x.mx" }],
      loaded,
      { pk: ["id"], uniqueSets: [["email"], ["id"]] },
      keep,
    );
    expect(got.get(0)).toEqual(["id", "email"]);
  });

  it("flags a composite unique index only when all its columns match", () => {
    const keys = { pk: [], uniqueSets: [["nombre", "email"]] };
    expect(findConflicts([{ nombre: "Ana", email: "otra@x.mx" }], loaded, keys, keep).size).toBe(0);
    expect(findConflicts([{ nombre: "Ana", email: "ana@x.mx" }], loaded, keys, keep).size).toBe(1);
  });

  it("never treats NULL as a duplicate, pending or loaded", () => {
    const keys = { pk: [], uniqueSets: [["email"]] };
    expect(findConflicts([{ email: null }, { email: null }], loaded, keys, keep).size).toBe(0);
  });

  it("never flags a column left out of the insert", () => {
    const keys = { pk: [], uniqueSets: [["email"]] };
    expect(findConflicts([{ nombre: "Luis" }], loaded, keys, keep).size).toBe(0);
  });

  it("skips a unique index on a column the loaded rows do not show", () => {
    const keys = { pk: [], uniqueSets: [["rfc"]] };
    expect(findConflicts([{ rfc: "X" }], loaded, keys, keep).size).toBe(0);
  });

  it("returns nothing when every value is new", () => {
    const got = findConflicts(
      [{ id: "10", email: "nuevo@x.mx" }],
      loaded,
      { pk: ["id"], uniqueSets: [["email"]] },
      keep,
    );
    expect(got.size).toBe(0);
  });
});
