import { describe, it, expect } from "vitest";
import {
  SHEET_FORMATS,
  countExportedRows,
  formatDescriptionKey,
  nameForFormat,
} from "../../src/utils/exportSheet";
import { exportResult } from "../../src/utils/exporters";
import { buildXlsx } from "../../src/utils/xlsx";
import { strToU8 } from "fflate";
import { translate } from "../../src/utils/translate";
import type { ResultSet } from "../../src/utils/query";

// The iPhone's export sheet (#578, tasks 6.3–6.5).
describe("nameForFormat", () => {
  it("swaps a known export extension for the format's", () => {
    expect(nameForFormat("salas.csv", "json")).toBe("salas.json");
    expect(nameForFormat("salas.XLSX", "csv")).toBe("salas.csv");
    expect(nameForFormat("salas", "xlsx")).toBe("salas.xlsx");
  });

  it("keeps any other dot as part of the name", () => {
    expect(nameForFormat("ventas.2026", "csv")).toBe("ventas.2026.csv");
  });

  it("keeps accents and makes unsafe characters safe", () => {
    expect(nameForFormat("  año/mes: 9 ", "sql")).toBe("año_mes_ 9.sql");
  });

  it("names a blank file export", () => {
    expect(nameForFormat("   ", "csv")).toBe("export.csv");
    expect(nameForFormat(".json", "html")).toBe("export.html");
  });
});

describe("formatDescriptionKey", () => {
  it("has a description for every format, in both languages", () => {
    for (const f of SHEET_FORMATS) {
      const key = formatDescriptionKey(f);
      expect(translate("es", key)).not.toBe(key);
      expect(translate("en", key)).not.toBe(key);
    }
  });
});

describe("countExportedRows", () => {
  const result: ResultSet = {
    columns: [
      { name: "n", type: "int" },
      { name: "nota", type: "text" },
    ],
    rows: Array.from({ length: 37 }, (_, i) => [String(i + 1), i % 5 === 0 ? null : `línea, "${i}"\nsegunda`]),
    truncated: false,
    rowsAffected: 0,
  };

  it("reads back every text format", () => {
    for (const f of ["csv", "json", "sql", "xml", "html"] as const) {
      expect(countExportedRows(f, strToU8(exportResult(result, f, "salas"))), f).toBe(37);
    }
  });

  it("reads back an xlsx, and takes bytes as a plain array too", () => {
    const bytes = buildXlsx(result, "salas");
    expect(countExportedRows("xlsx", bytes)).toBe(37);
    expect(countExportedRows("xlsx", Array.from(bytes))).toBe(37);
  });

  it("counts none in an empty result", () => {
    const empty = { ...result, rows: [] };
    expect(countExportedRows("csv", strToU8(exportResult(empty, "csv")))).toBe(0);
    expect(countExportedRows("html", strToU8(exportResult(empty, "html")))).toBe(0);
    expect(countExportedRows("xlsx", buildXlsx(empty, "t"))).toBe(0);
  });

  it("says so when an xlsx has no sheet", () => {
    expect(() => countExportedRows("xlsx", strToU8("not a zip"))).toThrow();
  });
});
