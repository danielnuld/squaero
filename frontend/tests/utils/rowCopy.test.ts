import { describe, it, expect } from "vitest";
import { rowToTsv, rowToJson } from "../../src/utils/rowCopy";
import type { ResultColumn } from "../../src/utils/query";

const cols: ResultColumn[] = [
  { name: "id", type: "int" },
  { name: "name", type: "text" },
  { name: "note", type: "text" },
];

describe("rowToTsv", () => {
  it("joins cells with tabs, NULL as empty", () => {
    expect(rowToTsv(["1", "Ana", null])).toBe("1\tAna\t");
  });

  it("handles an all-null row", () => {
    expect(rowToTsv([null, null])).toBe("\t");
  });
});

describe("rowToJson", () => {
  it("keys cells by column name, NULL as JSON null", () => {
    expect(rowToJson(cols, ["1", "Ana", null])).toBe(
      '{"id":"1","name":"Ana","note":null}',
    );
  });

  it("ignores extra cells beyond the columns", () => {
    expect(rowToJson([{ name: "a", type: "text" }], ["x", "y"])).toBe('{"a":"x"}');
  });
});
