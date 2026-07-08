import { describe, it, expect } from "vitest";
import { generalInfo, messageInfo, summaryLine, type InfoInput } from "../../src/utils/infoPane";

const base: InfoInput = {
  loading: false,
  error: null,
  columns: 0,
  rows: 0,
  truncated: false,
  elapsedMs: null,
  source: null,
};

describe("generalInfo", () => {
  it("reports result metrics", () => {
    const rows = generalInfo({ ...base, columns: 5, rows: 1280, elapsedMs: 42 });
    const map = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    expect(map["Filas"]).toBe((1280).toLocaleString());
    expect(map["Columnas"]).toBe("5");
    expect(map["Truncado"]).toBe("no");
    expect(map["Duración"]).toBeTruthy();
  });

  it("adds object + PK rows when a source is present", () => {
    const rows = generalInfo({
      ...base,
      columns: 3,
      rows: 10,
      source: { table: "clientes", db: "ventas", pk: ["id"] },
    });
    const map = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    expect(map["Objeto"]).toBe("ventas.clientes");
    expect(map["Clave primaria"]).toBe("id");
  });

  it("flags a PK-less source as read-only", () => {
    const rows = generalInfo({ ...base, source: { table: "t", pk: [] } });
    expect(rows.find((r) => r.k === "Clave primaria")!.v).toMatch(/solo lectura/);
  });

  it("marks truncation", () => {
    const rows = generalInfo({ ...base, rows: 1000, truncated: true });
    expect(rows.find((r) => r.k === "Truncado")!.v).toMatch(/hay más/);
  });
});

describe("messageInfo", () => {
  it("idle before any run", () => {
    expect(messageInfo(base).kind).toBe("idle");
  });
  it("surfaces an error", () => {
    const m = messageInfo({ ...base, error: "syntax error near FROM" });
    expect(m.kind).toBe("error");
    expect(m.text).toContain("syntax error");
  });
  it("reports success with count + duration", () => {
    const m = messageInfo({ ...base, columns: 2, rows: 3, elapsedMs: 12 });
    expect(m.kind).toBe("ok");
    expect(m.text).toContain("3 fila");
  });
  it("loading wins", () => {
    expect(messageInfo({ ...base, loading: true }).kind).toBe("loading");
  });
});

describe("summaryLine", () => {
  it("compact rows · duration · truncated", () => {
    expect(summaryLine({ ...base, rows: 3, elapsedMs: 12, truncated: true })).toMatch(
      /3 fila.*truncado/,
    );
  });
  it("idle + error states", () => {
    expect(summaryLine(base)).toBe("Sin resultados");
    expect(summaryLine({ ...base, error: "x" })).toMatch(/Error/);
  });
});
