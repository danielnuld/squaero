import { describe, it, expect } from "vitest";
import {
  engineErrorCode,
  unknownIdentifier,
  editDistance,
  closestName,
  didYouMean,
} from "../../src/utils/errorHints";
import { editorSchema } from "../../src/utils/sqlEditor";

describe("engineErrorCode", () => {
  it("reads Informix's SQLCA", () => {
    expect(engineErrorCode("SQLCODE -206, SQLSTATE 42000: e2e_items")).toBe("SQLCODE -206 · SQLSTATE 42000");
    expect(engineErrorCode("SQLCODE -268, ISAM -100, SQLSTATE 23000: u101_3")).toBe(
      "SQLCODE -268 · ISAM -100 · SQLSTATE 23000",
    );
  });
  it("reads an ODBC diagnostic's state", () => {
    expect(engineErrorCode("SQLExecDirect: [42S02] Table not found")).toBe("SQLSTATE 42S02");
  });
  it("reads MySQL's number and state", () => {
    expect(engineErrorCode("ERROR 1054 (42S22): Unknown column 'x'")).toBe("1054 · SQLSTATE 42S22");
  });
  it("reads a spelled-out SQLSTATE", () => {
    expect(engineErrorCode("failed, SQLSTATE: 40001")).toBe("SQLSTATE 40001");
  });
  it("is null when the message carries no code", () => {
    expect(engineErrorCode("no such column: telefono")).toBeNull();
    expect(engineErrorCode(null)).toBeNull();
    expect(engineErrorCode("")).toBeNull();
  });
});

describe("unknownIdentifier", () => {
  it.each([
    ["no such column: telefono", "column", "telefono"],
    ["no such column: c.telefono", "column", "telefono"],
    ["no such table: client", "table", "client"],
    ['ERROR:  column "telefono" does not exist\nLINE 1: SELECT telefono', "column", "telefono"],
    ['column "x" of relation "t" does not exist', "column", "x"],
    ['relation "public.client" does not exist', "table", "client"],
    ["Unknown column 'telefono' in 'field list'", "column", "telefono"],
    ["Table 'ventas.client' doesn't exist", "table", "client"],
    ["Invalid column name 'telefono'.", "column", "telefono"],
    ["Invalid object name 'dbo.client'.", "table", "client"],
  ])("%s", (msg, kind, name) => {
    expect(unknownIdentifier(msg)).toEqual({ kind, name });
  });
  it("is null for any other error", () => {
    expect(unknownIdentifier("syntax error at or near FROM")).toBeNull();
    expect(unknownIdentifier(undefined)).toBeNull();
  });
});

describe("editDistance", () => {
  it("counts edits, ignoring case", () => {
    expect(editDistance("email", "emial")).toBe(2);
    expect(editDistance("Email", "email")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("nombre", "nombres")).toBe(1);
  });
});

describe("closestName", () => {
  const cols = ["id", "nombre", "email", "ciudad", "saldo"];
  it("finds the one close name", () => {
    expect(closestName("nombres", cols)).toBe("nombre");
    expect(closestName("ciudd", cols)).toBe("ciudad");
  });
  it("finds a name that contains the unknown one", () => {
    expect(closestName("telefono", ["id", "telefono_movil"])).toBe("telefono_movil");
  });
  it("says nothing when nothing is close", () => {
    expect(closestName("telefono", cols)).toBeNull();
    expect(closestName("x", [])).toBeNull();
  });
  it("says nothing on a tie", () => {
    expect(closestName("cat", ["bat", "hat"])).toBeNull();
  });
  it("says nothing when the name does exist (the schema is just stale)", () => {
    expect(closestName("EMAIL", cols)).toBeNull();
  });
});

describe("didYouMean", () => {
  const schema = editorSchema({
    clientes: ["id", "nombre", "email", "ciudad"],
    pedidos: ["id", "cliente_id", "total"],
  });
  it("suggests a column of the tables the statement reads", () => {
    expect(didYouMean("no such column: nombres", "SELECT nombres FROM clientes", schema)).toEqual({
      kind: "column",
      name: "nombres",
      suggestion: "nombre",
      tables: ["clientes"],
    });
  });
  it("does not look in tables the statement does not read", () => {
    expect(didYouMean("no such column: totl", "SELECT totl FROM clientes", schema)).toBeNull();
  });
  it("suggests a known table", () => {
    expect(didYouMean("no such table: cliente", "SELECT * FROM cliente", schema)).toMatchObject({
      kind: "table",
      suggestion: "clientes",
    });
  });
  it("is null for another kind of error, or without a close match", () => {
    expect(didYouMean("syntax error", "SELEC 1", schema)).toBeNull();
    expect(didYouMean("no such table: zzz", "SELECT * FROM zzz", schema)).toBeNull();
  });
});
