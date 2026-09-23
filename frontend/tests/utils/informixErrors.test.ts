import { describe, it, expect } from "vitest";
import { parseSqlca, informixErrorText } from "../../src/utils/informixErrors";
import { describeError } from "../../src/utils/errors";
import { QueryError } from "../../src/utils/query";

describe("parseSqlca", () => {
  it("reads code, SQLSTATE and a token", () => {
    expect(parseSqlca("SQLCODE -206, SQLSTATE 42000: e2e_items")).toEqual({
      code: -206,
      isam: undefined,
      sqlstate: "42000",
      tokens: ["e2e_items"],
    });
  });
  it("reads the ISAM code and several tokens, behind a driver prefix", () => {
    const ca = parseSqlca("query: SQLCODE -268, ISAM -100, SQLSTATE 23000: informix.u101_3, x");
    expect(ca).toMatchObject({ code: -268, isam: -100, sqlstate: "23000" });
    expect(ca?.tokens).toEqual(["informix.u101_3", "x"]);
  });
  it("reads a message with no tokens", () => {
    expect(parseSqlca("SQLCODE -201, SQLSTATE 42000")?.tokens).toEqual([]);
  });
  it("returns null for a message without SQLCODE", () => {
    expect(parseSqlca("connection refused")).toBeNull();
  });
});

describe("informixErrorText", () => {
  it("fills the token in the locale's sentence", () => {
    expect(informixErrorText("SQLCODE -206, SQLSTATE 42000: clientes", "es")).toBe(
      "La tabla clientes no existe en la base de datos.",
    );
    expect(informixErrorText("SQLCODE -206, SQLSTATE 42000: clientes", "en")).toBe(
      "Table clientes does not exist in the database.",
    );
  });
  it("uses a sentence without tokens as is", () => {
    expect(informixErrorText("SQLCODE -201, SQLSTATE 42000", "en")).toBe("Syntax error in the statement.");
  });
  it("never invents: unknown code or missing token => null", () => {
    expect(informixErrorText("SQLCODE -99999, SQLSTATE HY000", "es")).toBeNull();
    expect(informixErrorText("SQLCODE -206, SQLSTATE 42000", "es")).toBeNull();
    expect(informixErrorText("syntax error near FROM", "es")).toBeNull();
  });
});

describe("describeError with an Informix SQLCODE", () => {
  it("puts the sentence as title and keeps the raw text as detail", () => {
    const raw = "SQLCODE -268, ISAM -100, SQLSTATE 23000: informix.u101_3";
    const f = describeError(new QueryError(raw, -32003), "en");
    expect(f.title).toBe("Unique constraint informix.u101_3 violated: that value already exists.");
    expect(f.detail).toBe(raw);
  });
  it("falls back to the domain title for an unknown code", () => {
    const f = describeError(new QueryError("SQLCODE -99999, SQLSTATE HY000", -32003), "es");
    expect(f.title).toMatch(/consulta/);
  });
});

// Messages captured from Informix 15 through libdrda (drdacli), 2026-09-22.
describe("informixErrorText — measured messages", () => {
  const cases: [string, string][] = [
    ["SQLCODE -217, SQLSTATE IX000: zz", "La columna zz no está en ninguna tabla de la consulta."],
    ["SQLCODE -236, SQLSTATE 21S01: t559", "El INSERT en t559 no tiene tantas columnas como valores."],
    ["SQLCODE -391, SQLSTATE 23000: t559.n", "La columna t559.n no admite NULL."],
    ["SQLCODE -691, SQLSTATE 23000: informix.r147_8", "Falta la fila referenciada por la llave foránea informix.r147_8."],
    ["SQLCODE -692, SQLSTATE 23000: informix.u146_5", "Otra tabla aún referencia la llave informix.u146_5 de esta fila."],
    ["SQLCODE -310, SQLSTATE S0001: informix.t559", "La tabla informix.t559 ya existe."],
    ["SQLCODE -703, SQLSTATE IX000: t559", "Una columna de la llave primaria de t559 no puede ser NULL."],
    ["SQLCODE -1204, SQLSTATE IX000", "Año inválido en la fecha."],
    ["SQLCODE -1213, SQLSTATE IX000", "No se pudo convertir el texto en número."],
  ];
  it.each(cases)("%s", (raw, text) => expect(informixErrorText(raw, "es")).toBe(text));
});
