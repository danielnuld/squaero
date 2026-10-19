import { describe, it, expect } from "vitest";
import { displayText, humanDate, regionalNumber } from "../../src/utils/gridDisplay";
import { translate } from "../../src/utils/i18n";

// What the grid SHOWS in each style (issue #540). The rule underneath every
// case here: it changes the pixels and nothing that can be copied, filtered or
// saved; values stay raw unless the regional number format is chosen.

const es = (key: string) => translate("es", key);
const en = (key: string) => translate("en", key);

describe("regionalNumber (R-13)", () => {
  it("groups thousands and uses the language's decimal mark", () => {
    expect(regionalNumber("1250.00", "es")).toBe("1.250,00");
    expect(regionalNumber("1250.00", "en")).toBe("1,250.00");
    expect(regionalNumber("-4321.99", "en")).toBe("-4,321.99");
    expect(regionalNumber("1234567", "en")).toBe("1,234,567");
  });

  // The core sends decimals and bigints as TEXT precisely because they do not
  // survive a float; going through Number would silently round them.
  it("keeps every digit and the trailing zeros", () => {
    expect(regionalNumber("9007199254740993", "en")).toBe("9,007,199,254,740,993");
    expect(regionalNumber("10000.500", "en")).toBe("10,000.500");
    expect(regionalNumber("999", "es")).toBe("999");
  });

  it("does not guess at anything that is not a plain decimal", () => {
    for (const v of ["1.5e10", "0x1F", "Infinity", "", "1,250"]) expect(regionalNumber(v, "en")).toBe(v);
  });
});

describe("humanDate", () => {
  it("writes an ISO date the way a person would", () => {
    expect(humanDate("2023-02-14", es)).toBe("14 feb 2023");
    expect(humanDate("2024-01-09", es)).toBe("9 ene 2024");
    expect(humanDate("2023-02-14", en)).toBe("14 Feb 2023");
  });

  it("keeps the time, and the zone, exactly as it arrived", () => {
    expect(humanDate("2023-02-14 08:30:00", es)).toBe("14 feb 2023 08:30:00");
    expect(humanDate("2023-02-14T08:30:00.123+02:00", es)).toBe(
      "14 feb 2023T08:30:00.123+02:00",
    );
  });

  // Informix can hand back dates shaped by DBDATE. An unformatted date beats a
  // wrong one.
  it("leaves a date it does not recognise alone", () => {
    expect(humanDate("14/02/2023", es)).toBe("14/02/2023");
    expect(humanDate("2023-13-01", es)).toBe("2023-13-01");
    expect(humanDate("", es)).toBe("");
    expect(humanDate("hoy", es)).toBe("hoy");
  });
});

describe("displayText", () => {
  it("shows the raw value in Registro and Hoja densa", () => {
    for (const style of ["registro", "hoja"] as const) {
      expect(displayText("1250.00", "float", style, es).text).toBe("1250.00");
      expect(displayText("2023-02-14", "date", style, es).text).toBe("2023-02-14");
    }
  });

  it("writes dates out in Informe, but keeps its numbers raw (rule 6)", () => {
    expect(displayText("1250.00", "float", "informe", es).text).toBe("1250.00");
    expect(displayText("2023-02-14", "date", "informe", es).text).toBe("14 feb 2023");
    expect(displayText("2023-02-14 08:30:00", "timestamp", "informe", es).text).toBe(
      "14 feb 2023 08:30:00",
    );
  });

  it("leaves text and blobs alone even in Informe", () => {
    expect(displayText("1250.00", "text", "informe", es).text).toBe("1250.00");
    expect(displayText("2023-02-14", "text", "informe", es).text).toBe("2023-02-14");
  });

  // NULL is not a value to format; it is the absence of one, and it says so the
  // same way in all three styles.
  it("renders NULL identically in every style", () => {
    for (const style of ["registro", "hoja", "informe"] as const) {
      const cell = displayText(null, "float", style, es);
      expect(cell.kind).toBe("null");
      expect(cell.text).toBe(displayText(null, "text", style, es).text);
    }
  });

  it("keeps the kind, which is what drives colour and alignment", () => {
    expect(displayText("1250", "int", "informe", es).kind).toBe("number");
    expect(displayText("2023-02-14", "date", "informe", es).kind).toBe("temporal");
    expect(displayText("1", "bool", "informe", es).kind).toBe("bool");
  });

  // Issue #690: the literal, in every style; formatCell folds the spellings.
  it("renders booleans as true/false in every style", () => {
    expect(displayText("true", "bool", "informe", es).text).toBe("true");
    expect(displayText("0", "bool", "informe", es).text).toBe("false");
    expect(displayText("t", "bool", "registro", es).text).toBe("true");
    expect(displayText("", "bool", "hoja", es).text).toBe("true");
    expect(displayText(null, "bool", "registro", es).kind).toBe("null");
  });

  it("groups numbers in any style only when the regional format is chosen", () => {
    for (const style of ["registro", "hoja", "informe"] as const) {
      expect(displayText("1250.00", "float", style, es, { numbers: "regional", locale: "es" }).text).toBe("1.250,00");
    }
    expect(displayText("1250.00", "text", "registro", es, { numbers: "regional" }).text).toBe("1250.00");
  });

  it("writes NULL as the chosen text, keeping its kind (R-25)", () => {
    const cell = displayText(null, "int", "registro", es, { nullText: "(nulo)" });
    expect(cell).toMatchObject({ kind: "null", text: "(nulo)" });
  });

  it("shows a boolean it cannot fold as it came", () => {
    expect(displayText("maybe", "bool", "registro", es).text).toBe("maybe");
  });
});
