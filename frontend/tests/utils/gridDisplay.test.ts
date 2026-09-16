import { describe, it, expect } from "vitest";
import { displayText, groupThousands, humanDate } from "../../src/utils/gridDisplay";
import { translate } from "../../src/utils/i18n";

// What the grid SHOWS in each style (issue #540). The rule underneath every
// case here: only "informe" changes anything, and even there it changes the
// pixels and nothing that can be copied, filtered or saved.

const es = (key: string) => translate("es", key);
const en = (key: string) => translate("en", key);

describe("groupThousands", () => {
  it("groups the integer part and leaves the fraction alone", () => {
    expect(groupThousands("1250")).toBe("1,250");
    expect(groupThousands("1250.00")).toBe("1,250.00");
    expect(groupThousands("-4321.99")).toBe("-4,321.99");
    expect(groupThousands("1234567.5")).toBe("1,234,567.5");
  });

  // The core sends decimals and bigints as TEXT precisely because they do not
  // survive a float; going through Number would silently round them.
  it("keeps every digit of a value beyond what a double can hold", () => {
    expect(groupThousands("9007199254740993")).toBe("9,007,199,254,740,993");
    expect(groupThousands("123456789012345678901234567890")).toBe(
      "123,456,789,012,345,678,901,234,567,890",
    );
  });

  it("keeps trailing zeros, which are precision in a decimal column", () => {
    expect(groupThousands("12.00")).toBe("12.00");
    expect(groupThousands("10000.500")).toBe("10,000.500");
  });

  it("leaves anything under four digits untouched", () => {
    expect(groupThousands("999")).toBe("999");
    expect(groupThousands("0")).toBe("0");
    expect(groupThousands("-7")).toBe("-7");
  });

  // Known and accepted: a year in a numeric column becomes "2,024". Length
  // cannot tell a year from a quantity; only the column can, and that belongs
  // where the metadata is.
  it("groups a four-digit value too, year or not", () => {
    expect(groupThousands("2024")).toBe("2,024");
  });

  it("does not guess at anything that is not a plain decimal", () => {
    expect(groupThousands("1.5e10")).toBe("1.5e10");
    expect(groupThousands("0x1F")).toBe("0x1F");
    expect(groupThousands("Infinity")).toBe("Infinity");
    expect(groupThousands("")).toBe("");
    expect(groupThousands("1,250")).toBe("1,250");
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

  it("formats numbers and dates in Informe", () => {
    expect(displayText("1250.00", "float", "informe", es).text).toBe("1,250.00");
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

  it("still renders booleans as 0/1, which formatCell owns", () => {
    expect(displayText("true", "bool", "informe", es).text).toBe("1");
    expect(displayText("0", "bool", "informe", es).text).toBe("0");
  });
});
