import { describe, it, expect } from "vitest";
import { describeError, errorLine, errorText } from "../../src/utils/errors";
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

// A dead session the transport did not retry says why (issue #676).
describe("describeError — lost connection, not retried", () => {
  const lost = (notRetried: string) =>
    new QueryError("server closed the connection", -32000, {
      connLost: true,
      inTx: notRetried === "tx",
      retrySafe: false,
      notRetried,
    });
  it("names the transaction the server rolled back", () => {
    const f = describeError(lost("tx"), "en");
    expect(f.title).toMatch(/transaction open/);
    expect(f.detail).toBe("server closed the connection");
    expect(describeError(lost("tx"), "es").title).toMatch(/transacción abierta/);
  });
  it("says a restored session did not re-run the statement", () => {
    expect(describeError(lost("unsafe"), "en").title).toMatch(/re-established.*may or may not have run/);
  });
  it("says the connection is still down", () => {
    expect(describeError(lost("down"), "en").title).toMatch(/was lost.*not retried/);
  });
  it("an unknown reason falls back to the generic connection title", () => {
    expect(describeError(lost("bogus"), "es").title).toMatch(/No se pudo conectar/);
  });
});

describe("errorLine", () => {
  it("reads the line each engine names", () => {
    expect(errorLine("You have an error in your SQL syntax ... near 'FORM t' at line 3")).toBe(3);
    expect(errorLine('syntax error at or near "FORM"\nLINE 2: SELECT * FORM t')).toBe(2);
    expect(errorLine("Incorrect syntax near 'FORM'. Line 4")).toBe(4);
    expect(errorLine("error de sintaxis en la línea 5")).toBe(5);
  });

  it("is null when the message names no line", () => {
    expect(errorLine("near \"FORM\": syntax error")).toBeNull();
    expect(errorLine("")).toBeNull();
    expect(errorLine(null)).toBeNull();
    expect(errorLine(undefined)).toBeNull();
  });

  it("ignores words that merely contain it and a line 0", () => {
    expect(errorLine("pipeline 3 failed")).toBeNull();
    expect(errorLine("at line 0")).toBeNull();
  });
});
