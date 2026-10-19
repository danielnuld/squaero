import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseFile,
  parseClipboard,
  runImport,
  detectEncoding,
  decodeBytes,
  detectDelimiter,
  detectQuote,
  detectHeader,
  detectDialect,
  positionalHeaders,
  targetColumns,
  mapByName,
  assignedCount,
  typeFamily,
  convertPreview,
  type ImportOps,
  type ParsedTable,
} from "../../src/utils/importers";

// The P5 half of importers.ts (#692): reading a file the way it was written,
// mapping onto the target's columns, and the live error list.

describe("runImport live errors", () => {
  it("hands each failed row over as it fails", async () => {
    let n = 0;
    const ops: ImportOps = {
      begin: async () => {},
      commit: async () => {},
      rollback: async () => {},
      insert: async () => {
        const i = n++;
        if (i === 0 || i === 2) throw new Error(`row ${i}`);
      },
    };
    const seen: number[] = [];
    const parsed: ParsedTable = { headers: ["a"], rows: [["1"], ["2"], ["3"]] };
    await runImport(parsed, { a: "a" }, "skip", ops, { onError: (e) => seen.push(e.row) });
    expect(seen).toEqual([0, 2]);
  });
});

describe("parseCsv dialect options", () => {
  it("reads a semicolon CSV", () => {
    expect(parseCsv("a;b\n1;2", ";")).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });
  it("honours a single-quote quote", () => {
    expect(parseCsv("a,b\n'x,y',z", ",", "'").rows).toEqual([["x,y", "z"]]);
  });
  it("names the columns #1… when there is no header row", () => {
    expect(parseCsv("1,2\n3", ",", '"', false)).toEqual({ headers: ["#1", "#2"], rows: [["1", "2"], ["3"]] });
    expect(positionalHeaders(0)).toEqual([]);
  });
});

describe("encoding detection", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("trusts a BOM", () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("utf-8");
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0]))).toBe("utf-16le");
    expect(detectEncoding(new Uint8Array([0xfe, 0xff, 0, 0x61]))).toBe("utf-16be");
  });
  it("takes valid UTF-8 as UTF-8, anything else as Windows-1252", () => {
    expect(detectEncoding(enc("año"))).toBe("utf-8");
    expect(detectEncoding(new Uint8Array([0x61, 0xf1, 0x6f]))).toBe("windows-1252"); // «año» in 1252
    expect(detectEncoding(new Uint8Array([]))).toBe("utf-8");
  });
  it("decodes in the chosen encoding, dropping the BOM", () => {
    expect(decodeBytes(new Uint8Array([0x61, 0xf1, 0x6f]), "windows-1252")).toBe("año");
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), "utf-8")).toBe("a");
  });
});

describe("dialect detection", () => {
  it("finds the delimiter every line agrees on", () => {
    expect(detectDelimiter("a;b;c\n1;2,5;3\n4;5;6")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter("a|b\n1|2")).toBe("|");
    expect(detectDelimiter('a,b\n"1,5",2')).toBe(",");
  });
  it("falls back to the first line, then to a comma", () => {
    expect(detectDelimiter("a;b\n1;2;3")).toBe(";");
    expect(detectDelimiter("solo")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });
  it("finds the quote", () => {
    expect(detectQuote('a,"b"', ",")).toBe('"');
    expect(detectQuote("a,'b c'", ",")).toBe("'");
    expect(detectQuote("o'brien,x", ",")).toBe('"');
    expect(detectQuote("a|'b'", "|")).toBe("'");
  });
  it("tells a header from a row of data", () => {
    expect(detectHeader(["id", "nombre"])).toBe(true);
    expect(detectHeader(["1", "Ana"])).toBe(false);
    expect(detectHeader(["x", "2025-07-01"])).toBe(false);
    expect(detectHeader(["x", ""])).toBe(false);
    expect(detectHeader([])).toBe(false);
  });
  it("sniffs a Spanish-locale export in one go", () => {
    expect(detectDialect("nombre;saldo\nAna;450,00")).toEqual({ delimiter: ";", quote: '"', header: true });
    expect(detectDialect("1;Ana\n2;Pedro").header).toBe(false);
  });
  it("parseFile reads a semicolon .csv", () => {
    expect(parseFile("x.csv", "a;b\n1;2").headers).toEqual(["a", "b"]);
  });
  it("parseClipboard reads semicolons too", () => {
    expect(parseClipboard("a;b\n1;2").headers).toEqual(["a", "b"]);
  });
});

describe("target columns and mapping", () => {
  const desc = (cols: string[], rows: (string | null)[][]) => ({
    columns: cols.map((name) => ({ name, type: "text" })),
    rows,
    truncated: false,
    rowsAffected: 0,
  });
  it("marks what the database assigns", () => {
    const pg = desc(["name", "type", "pk", "dflt_value"], [
      ["id", "integer", "1", "nextval('c_id_seq'::regclass)"],
      ["code", "serial", "0", null],
      ["nombre", "text", "0", null],
    ]);
    expect(targetColumns(pg).map((c) => c.auto)).toEqual([true, true, false]);
    const lite = desc(["name", "type", "pk"], [["id", "INTEGER", "1"], ["n", "TEXT", "0"]]);
    expect(targetColumns(lite, "sqlite")[0]).toEqual({ name: "id", type: "INTEGER", auto: true });
    expect(targetColumns(lite, "mysql")[0].auto).toBe(false);
    const my = desc(["name", "type", "extra"], [["id", "int", "auto_increment"]]);
    expect(targetColumns(my)[0].auto).toBe(true);
    expect(targetColumns(desc(["x"], [["a"]]))).toEqual([]);
  });
  it("assigns by name, ignoring case, accents and underscores, and leaves the autoincrement out", () => {
    const targets = [
      { name: "id", type: "integer", auto: true },
      { name: "telefono", type: "text", auto: false },
      { name: "fecha_alta", type: "date", auto: false },
      { name: "nota", type: "text", auto: false },
    ];
    const m = mapByName(["ID", "Teléfono", "Fecha Alta"], targets);
    expect(m).toEqual({ id: null, telefono: "Teléfono", fecha_alta: "Fecha Alta", nota: null });
    expect(assignedCount(m)).toBe(2);
    expect(assignedCount({})).toBe(0);
  });
});

describe("conversion preview", () => {
  it("classifies declared types", () => {
    expect(typeFamily("numeric(10,2)")).toBe("num");
    expect(typeFamily("BIGINT")).toBe("int");
    expect(typeFamily("boolean")).toBe("bool");
    expect(typeFamily("bit(1)")).toBe("bool");
    expect(typeFamily("timestamp with time zone")).toBe("datetime");
    expect(typeFamily("date")).toBe("date");
    expect(typeFamily("time")).toBe("time");
    expect(typeFamily("varchar(20)")).toBe("text");
  });
  it("says what a boolean becomes", () => {
    expect(convertPreview("1", "boolean")).toEqual({ text: "1", to: "true" });
    expect(convertPreview("No", "bool")).toEqual({ text: "No", to: "false" });
    expect(convertPreview("quizá", "bool").warn).toBe("imp.warn.bool");
  });
  it("warns when a value does not fit", () => {
    expect(convertPreview("12", "int")).toEqual({ text: "12" });
    expect(convertPreview("1.5", "int").warn).toBe("imp.warn.int");
    expect(convertPreview("450.00", "numeric")).toEqual({ text: "450.00" });
    expect(convertPreview("450,00", "numeric").warn).toBe("imp.warn.decimalComma");
    expect(convertPreview("abc", "real").warn).toBe("imp.warn.num");
    expect(convertPreview("2025-07-01", "date")).toEqual({ text: "2025-07-01" });
    expect(convertPreview("2025-02-31", "date").warn).toBe("imp.warn.date");
    expect(convertPreview("31/02/2025", "date").warn).toBe("imp.warn.date");
    expect(convertPreview("2025-07-01 10:00", "timestamp")).toEqual({ text: "2025-07-01 10:00" });
    expect(convertPreview("10:30", "time")).toEqual({ text: "10:30" });
    expect(convertPreview("x", "time").warn).toBe("imp.warn.time");
  });
  it("shows NULL and leaves text alone", () => {
    expect(convertPreview(null, "int")).toEqual({ text: "NULL" });
    expect(convertPreview("lo que sea", "text")).toEqual({ text: "lo que sea" });
  });
});
