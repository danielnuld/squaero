import { describe, it, expect } from "vitest";
import {
  findVariables,
  applyVariables,
  missingVariables,
  varToken,
  type VarValues,
} from "../../src/utils/sqlVariables";

describe("findVariables", () => {
  it("finds both forms, once each, in the order they appear", () => {
    const sql = "SELECT * FROM ${tabla} WHERE fecha >= :desde AND estado = :estado AND o = :desde";
    expect(findVariables(sql)).toEqual([
      { name: "tabla", kind: "raw", token: "${tabla}" },
      { name: "desde", kind: "value", token: ":desde" },
      { name: "estado", kind: "value", token: ":estado" },
    ]);
  });

  it("keeps :x and ${x} apart: they do different things to the SQL", () => {
    expect(findVariables("SELECT :x, ${x}").map((v) => v.token)).toEqual(["\:x", "${x}"]);
  });

  it("ignores a colon inside a string, an identifier or a comment", () => {
    expect(findVariables("SELECT '12:30' AS t -- :nope\nFROM a")).toEqual([]);
    expect(findVariables('SELECT "col:x" FROM a')).toEqual([]);
    expect(findVariables("SELECT `col:x` FROM a")).toEqual([]);
    expect(findVariables("/* :nope */ SELECT 1")).toEqual([]);
    expect(findVariables("SELECT $$ :nope $$")).toEqual([]);
  });

  it("is not fooled by a Postgres cast", () => {
    expect(findVariables("SELECT id::text FROM a WHERE x = :val")).toEqual([
      { name: "val", kind: "value", token: ":val" },
    ]);
  });

  it("needs a name: a lone colon or a digit is punctuation", () => {
    expect(findVariables("SELECT * FROM a WHERE t = '1' AND x = : 1")).toEqual([]);
    expect(findVariables("SELECT ${} FROM a")).toEqual([]);
    expect(findVariables("SELECT ${no-cierra FROM a")).toEqual([]);
  });

  it("leaves colons alone for MongoDB, whose own syntax is full of them", () => {
    const q = "db.items.find({estado:1, tipo:2})";
    expect(findVariables(q, "mongodb")).toEqual([]);
    expect(findVariables("db.${col}.find({})", "mongodb")).toEqual([
      { name: "col", kind: "raw", token: "${col}" },
    ]);
  });
});

describe("applyVariables", () => {
  const values: VarValues = {
    ":desde": { text: "2026-01-01" },
    ":estado": { text: "activo" },
    "${tabla}": { text: "facturas" },
  };

  it("writes a value as a literal and raw text as typed", () => {
    expect(
      applyVariables("SELECT * FROM ${tabla} WHERE fecha >= :desde AND estado = :estado", values),
    ).toBe("SELECT * FROM facturas WHERE fecha >= '2026-01-01' AND estado = 'activo'");
  });

  it("replaces every occurrence, not just the first", () => {
    expect(applyVariables("SELECT :estado, :estado", values)).toBe(
      "SELECT 'activo', 'activo'",
    );
  });

  it("leaves a number unquoted, so LIMIT :n is still SQL", () => {
    expect(applyVariables("SELECT * FROM a LIMIT :n", { ":n": { text: "10" } })).toBe(
      "SELECT * FROM a LIMIT 10",
    );
    expect(applyVariables("SELECT :x", { ":x": { text: "-2.5" } })).toBe("SELECT -2.5");
  });

  it("doubles the quotes inside a value", () => {
    expect(applyVariables("SELECT :x", { ":x": { text: "O'Hara" } })).toBe(
      "SELECT 'O''Hara'",
    );
  });

  it("escapes a backslash for MySQL, which reads it as an escape", () => {
    const path = { ":p": { text: "C:\\tmp" } };
    expect(applyVariables("SELECT :p", path, "mysql")).toBe("SELECT 'C:\\\\tmp'");
    expect(applyVariables("SELECT :p", path, "postgres")).toBe("SELECT 'C:\\tmp'");
  });

  it("writes the NULL keyword only when it was chosen, not when it was typed", () => {
    expect(applyVariables("SELECT :x", { ":x": { text: "", isNull: true } })).toBe(
      "SELECT NULL",
    );
    expect(applyVariables("SELECT :x", { ":x": { text: "NULL" } })).toBe("SELECT 'NULL'");
  });

  it("leaves a variable with no value in place rather than dropping it", () => {
    expect(applyVariables("SELECT * FROM a WHERE x = :falta", {})).toBe(
      "SELECT * FROM a WHERE x = :falta",
    );
  });

  it("does not substitute inside strings or comments", () => {
    expect(applyVariables("SELECT ':estado' -- :estado\n, :estado", values)).toBe(
      "SELECT ':estado' -- :estado\n, 'activo'",
    );
  });
});

describe("missingVariables", () => {
  const vars = findVariables("SELECT * FROM ${t} WHERE a = :a AND b = :b");

  it("names the ones with nothing to write", () => {
    expect(missingVariables(vars, { ":a": { text: "1" } }).map((v) => v.token)).toEqual([
      "${t}",
      "\:b",
    ]);
  });

  it("counts a blank box as missing, but an explicit NULL as answered", () => {
    const values: VarValues = {
      "${t}": { text: "  " },
      ":a": { text: "", isNull: true },
      ":b": { text: "x" },
    };
    expect(missingVariables(vars, values).map((v) => v.token)).toEqual(["${t}"]);
  });
});

describe("varToken", () => {
  it("spells each kind the way the editor writes it", () => {
    expect(varToken("x", "value")).toBe(":x");
    expect(varToken("x", "raw")).toBe("${x}");
  });
});
