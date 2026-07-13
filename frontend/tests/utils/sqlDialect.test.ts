import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import {
  MySQL,
  PostgreSQL,
  StandardSQL,
  schemaCompletionSource,
} from "@codemirror/lang-sql";
import { editorDialect, completionQuote } from "../../src/utils/sqlDialect";

describe("editorDialect", () => {
  it("maps known engines to their dialect", () => {
    expect(editorDialect("mysql")).toBe(MySQL);
    expect(editorDialect("postgres")).toBe(PostgreSQL);
    expect(editorDialect("postgresql")).toBe(PostgreSQL);
  });
  it("is case-insensitive", () => {
    expect(editorDialect("MySQL")).toBe(MySQL);
  });
  it("falls back to StandardSQL for unknown or absent engines", () => {
    expect(editorDialect("whatever")).toBe(StandardSQL);
    expect(editorDialect(undefined)).toBe(StandardSQL);
    expect(editorDialect(null)).toBe(StandardSQL);
    expect(editorDialect("")).toBe(StandardSQL);
  });
});

describe("completionQuote", () => {
  // The bug: MySQL completions came back as "Clientes" — a string literal there.
  it("gives MySQL and MariaDB the backtick, never the double quote", () => {
    expect(completionQuote("mysql")).toBe("`");
    expect(completionQuote("mariadb")).toBe("`");
  });
  it("keeps the ANSI double quote on PostgreSQL", () => {
    expect(completionQuote("postgres")).toBe('"');
  });
  it("defaults to the ANSI double quote for unknown engines", () => {
    expect(completionQuote("whatever")).toBe('"');
  });
});

// The regression itself, through CodeMirror's own completion source — the code
// SqlEditor wires up via sql({dialect, schema}). Completing the table `Clientes`
// (upper-case, so lang-sql insists on quoting it) used to insert "Clientes",
// which MySQL reads as a string literal: `SELECT * FROM "Clientes"` is a syntax
// error there.
function completionFor(table: string, engine: string): Completion | undefined {
  const source = schemaCompletionSource({
    dialect: editorDialect(engine),
    schema: { [table]: ["id", "nombre"] },
  });
  const doc = `SELECT * FROM ${table.slice(0, 3)}`;
  const state = EditorState.create({ doc });
  const result = source(new CompletionContext(state, doc.length, true));
  const options = (result && "options" in result ? result.options : []) as Completion[];
  return options.find((o) => o.label === table);
}

/** What the editor would actually insert for this completion. */
const inserted = (c: Completion | undefined) =>
  typeof c?.apply === "string" ? c.apply : (c?.label ?? "");

describe("table completion (the reported bug)", () => {
  it("inserts an upper-case MySQL table in backticks, never in double quotes", () => {
    expect(inserted(completionFor("Clientes", "mysql"))).toBe("`Clientes`");
  });
  it("still uses the ANSI double quote on PostgreSQL", () => {
    expect(inserted(completionFor("Clientes", "postgres"))).toBe('"Clientes"');
  });
  it("leaves an Informix table bare (it has no delimited identifiers)", () => {
    expect(inserted(completionFor("Clientes", "informix"))).toBe("Clientes");
  });
  it("never quotes a plain lower-case name", () => {
    expect(inserted(completionFor("clientes", "mysql"))).toBe("clientes");
  });
});

describe("informix identifiers", () => {
  // Informix rejects delimited identifiers unless DELIMIDENT is set, and folds
  // names to lower case: declaring them case-insensitive stops the completer
  // from quoting an upper-case table name.
  it("is case-insensitive so upper-case names are completed bare", () => {
    expect(editorDialect("informix").spec.caseInsensitiveIdentifiers).toBe(true);
  });
});
