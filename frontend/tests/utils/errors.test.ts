import { describe, it, expect } from "vitest";
import { describeError, errorText } from "../../src/utils/errors";
import { QueryError } from "../../src/utils/query";

describe("describeError — domain codes", () => {
  it("maps connection errors to an actionable title", () => {
    const f = describeError(new QueryError("connection refused", -32000));
    expect(f.title).toMatch(/No se pudo conectar/);
    expect(f.detail).toBe("connection refused");
  });
  it("maps unsupported without redundant detail", () => {
    const f = describeError(new QueryError("Operación no soportada por este motor.", -32001));
    expect(f.title).toMatch(/no soportada/);
    // detail suppressed when it equals the title
    expect(f.detail).toBeUndefined();
  });
  it("maps not-found and query errors", () => {
    expect(describeError(new QueryError("x", -32002)).title).toMatch(/no encontrado/);
    expect(describeError(new QueryError("syntax error", -32003)).title).toMatch(/consulta/);
  });
});

describe("describeError — standard codes", () => {
  it("flags a method-not-found as a version mismatch", () => {
    expect(describeError(new QueryError("m", -32601)).title).toMatch(/incompatible/);
  });
  it("keeps the raw message for an unknown code", () => {
    expect(describeError(new QueryError("weird", -40000).valueOf()).title).toBe("weird");
  });
});

describe("describeError — non-QueryError", () => {
  it("uses an Error's message", () => {
    expect(describeError(new Error("boom")).title).toBe("boom");
  });
  it("stringifies anything else", () => {
    expect(describeError("plain string").title).toBe("plain string");
    expect(describeError(42).title).toBe("42");
  });
});

describe("errorText", () => {
  it("joins title and detail when detail adds info", () => {
    expect(errorText(new QueryError("host down", -32000))).toBe(
      "No se pudo conectar. Revisa el host, el puerto y las credenciales. (host down)",
    );
  });
  it("is just the title when there is no extra detail", () => {
    expect(errorText(new QueryError("Operación no soportada por este motor.", -32001))).toBe(
      "Operación no soportada por este motor.",
    );
  });
});
