import { describe, it, expect } from "vitest";
import {
  makeRng,
  defaultGen,
  generateValue,
  generateRows,
  clampCount,
  type ColumnGen,
  maxSql,
  nextSequenceStart,
  defaultTemplate,
  fillTemplate,
  TEMPLATE_TOKENS,
} from "../../src/utils/dataGen";

/** A ColumnGen with the given overrides on top of a text default. */
function gen(over: Partial<ColumnGen>): ColumnGen {
  return { ...defaultGen(over.column ?? "c", over.type ?? "text"), ...over };
}

describe("defaultGen", () => {
  it("picks a strategy from the neutral type", () => {
    expect(defaultGen("id", "int", true).kind).toBe("sequence");
    expect(defaultGen("qty", "int").kind).toBe("number");
    expect(defaultGen("price", "float")).toMatchObject({ kind: "number", decimals: 2 });
    expect(defaultGen("ok", "bool").kind).toBe("boolean");
    expect(defaultGen("created", "timestamp").kind).toBe("date");
    expect(defaultGen("name", "text").kind).toBe("text");
  });

  it("classifies engine-native type names, not just neutral ones", () => {
    expect(defaultGen("a", "INTEGER").kind).toBe("number");
    expect(defaultGen("a", "bigint").kind).toBe("number");
    expect(defaultGen("a", "serial", false).kind).toBe("number");
    expect(defaultGen("a", "DOUBLE PRECISION").kind).toBe("number");
    expect(defaultGen("a", "decimal(10,2)")).toMatchObject({ kind: "number", decimals: 2 });
    expect(defaultGen("a", "datetime").kind).toBe("date");
    expect(defaultGen("a", "varchar(50)").kind).toBe("text");
  });
});

describe("date formatting tolerates engine type names", () => {
  it("datetime -> date+time, time -> time only", () => {
    const dt = generateValue(gen({ kind: "date", type: "datetime", from: "2020-01-01", to: "2020-12-31" }), 0, makeRng(3));
    expect(dt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const tm = generateValue(gen({ kind: "date", type: "time" }), 0, makeRng(3));
    expect(tm).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe("generateValue", () => {
  const rng = makeRng(1);

  it("sequence counts from start by step, independent of rng", () => {
    const g = gen({ kind: "sequence", seqStart: 100, seqStep: 5 });
    expect(generateValue(g, 0, rng)).toBe("100");
    expect(generateValue(g, 3, rng)).toBe("115");
  });

  it("number stays within [min,max] and honors decimals", () => {
    const g = gen({ kind: "number", min: 10, max: 20, decimals: 2 });
    for (let i = 0; i < 50; i++) {
      const v = Number(generateValue(g, i, makeRng(i)));
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
      expect(generateValue(g, i, makeRng(i))).toMatch(/^\d+\.\d{2}$/);
    }
    // decimals 0 -> integer string
    expect(generateValue(gen({ kind: "number", min: 0, max: 9, decimals: 0 }), 0, makeRng(2)))
      .toMatch(/^\d+$/);
  });

  it("null and skip both resolve to null; fixed returns the constant", () => {
    expect(generateValue(gen({ kind: "null" }), 0, rng)).toBeNull();
    expect(generateValue(gen({ kind: "fixed", fixed: "X" }), 0, rng)).toBe("X");
  });

  it("boolean returns 1 or 0", () => {
    const v = generateValue(gen({ kind: "boolean" }), 0, makeRng(5));
    expect(["0", "1"]).toContain(v);
  });

  it("list picks one of the options, NULL for an empty list", () => {
    const g = gen({ kind: "list", list: "a, b ,c" });
    for (let i = 0; i < 20; i++) {
      expect(["a", "b", "c"]).toContain(generateValue(g, i, makeRng(i)));
    }
    expect(generateValue(gen({ kind: "list", list: "  " }), 0, rng)).toBeNull();
  });

  it("date formats by neutral type", () => {
    const d = generateValue(gen({ kind: "date", type: "date", from: "2020-01-01", to: "2020-12-31" }), 0, makeRng(3));
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ts = generateValue(gen({ kind: "date", type: "timestamp", from: "2020-01-01", to: "2020-12-31" }), 0, makeRng(3));
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const tm = generateValue(gen({ kind: "date", type: "time" }), 0, makeRng(3));
    expect(tm).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("is deterministic for a given seed", () => {
    const g = gen({ kind: "text" });
    expect(generateValue(g, 0, makeRng(42))).toBe(generateValue(g, 0, makeRng(42)));
  });
});

describe("generateRows", () => {
  it("builds N maps, omitting skipped columns", () => {
    const gens: ColumnGen[] = [
      gen({ column: "id", kind: "sequence", seqStart: 1, seqStep: 1 }),
      gen({ column: "name", kind: "text" }),
      gen({ column: "internal", kind: "skip" }),
    ];
    const rows = generateRows(gens, 3, makeRng(7));
    expect(rows.length).toBe(3);
    expect(rows[0].id).toBe("1");
    expect(rows[2].id).toBe("3");
    expect(Object.keys(rows[0])).toEqual(["id", "name"]); // internal omitted
  });
});

describe("clampCount", () => {
  it("bounds into 1..10000 and floors", () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(5.9)).toBe(5);
    expect(clampCount(99999)).toBe(10000);
    expect(clampCount(NaN)).toBe(1);
  });
});

describe("maxSql", () => {
  it("quotes the key and qualifies the table per engine", () => {
    expect(maxSql("id", { table: "users", db: "shop" }, "mysql")).toBe("SELECT MAX(`id`) FROM `shop`.`users`");
    expect(maxSql("id", { table: "users", schema: "app" }, "postgres")).toBe('SELECT MAX("id") FROM "app"."users"');
  });
});

describe("nextSequenceStart", () => {
  it("is MAX + 1", () => {
    expect(nextSequenceStart("12")).toBe(13);
    expect(nextSequenceStart("0")).toBe(1);
  });

  it("is 1 on an empty table or a maximum that is not a number", () => {
    expect(nextSequenceStart(null)).toBe(1);
    expect(nextSequenceStart(undefined)).toBe(1);
    expect(nextSequenceStart("")).toBe(1);
    expect(nextSequenceStart("abc")).toBe(1);
  });
});

describe("text templates (#692)", () => {
  it("picks a template from the column name", () => {
    expect(defaultTemplate("email")).toBe("{email}");
    expect(defaultTemplate("correo_contacto")).toBe("{email}");
    expect(defaultTemplate("nombre")).toBe("{nombre} {apellido}");
    expect(defaultTemplate("apellido")).toBe("{apellido}");
    expect(defaultTemplate("city")).toBe("{ciudad}");
    expect(defaultTemplate("telefono")).toMatch(/^662 /);
    expect(defaultTemplate("notas")).toBe("{palabra} {palabra}");
    expect(defaultGen("email", "text").template).toBe("{email}");
  });

  it("fills the tokens and leaves the rest as written", () => {
    const rng = makeRng(1);
    expect(fillTemplate("cliente {n}", 4, rng)).toBe("cliente 5");
    expect(fillTemplate("{#}{#}", 0, rng)).toMatch(/^\d\d$/);
    expect(fillTemplate("{desconocido}", 0, rng)).toBe("{desconocido}");
    expect(fillTemplate("{email}", 2, makeRng(3))).toMatch(/^[a-z]+\.[a-z]+3@correo\.mx$/);
    expect(fillTemplate("{nombre} {apellido} de {ciudad}", 0, makeRng(9))).toMatch(/^\S+ \S+ de \S+$/);
    expect(TEMPLATE_TOKENS).toContain("{palabra}");
  });

  it("a text column generates from its template", () => {
    const g = { ...defaultGen("c", "text"), template: "x{n}" };
    expect(generateValue(g, 6, makeRng(1))).toBe("x7");
  });
});
