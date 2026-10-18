import { describe, it, expect } from "vitest";
import {
  BUILTIN_TEMPLATES,
  normalizeAbbr,
  resolveTemplates,
  templateAt,
  templateToSnippet,
  type SqlTemplate,
} from "../../src/utils/sqlTemplates";
import type { Snippet } from "../../src/utils/snippets";

const tpl = (abbr: string, body = "X"): SqlTemplate => ({ abbr, name: abbr, body });

describe("normalizeAbbr", () => {
  it("trims and lower-cases a word", () => {
    expect(normalizeAbbr(" Sel ")).toBe("sel");
    expect(normalizeAbbr("_my_tpl2")).toBe("_my_tpl2");
  });

  it("rejects anything that is not a single word", () => {
    for (const bad of ["", "  ", "two words", "9a", "a-b", "a.b", "${x}", "ñu"]) {
      expect(normalizeAbbr(bad)).toBeNull();
    }
  });
});

describe("resolveTemplates", () => {
  const snip = (id: string, name: string, body: string, abbr?: string): Snippet => ({
    id,
    name,
    body,
    ...(abbr === undefined ? {} : { abbr }),
  });

  it("offers every built-in when no snippet has an abbreviation", () => {
    const out = resolveTemplates([snip("snip-1", "a", "SELECT 1")], BUILTIN_TEMPLATES);
    expect(out.map((t) => t.abbr)).toEqual(["sel", "ins", "upd", "del", "cte"]);
  });

  it("lets a user snippet override the built-in with the same abbreviation", () => {
    const out = resolveTemplates([snip("snip-1", "mine", "SELECT 1", "SEL")], BUILTIN_TEMPLATES);
    const sel = out.filter((t) => t.abbr === "sel");
    expect(sel).toEqual([{ abbr: "sel", name: "mine", body: "SELECT 1" }]);
    expect(out).toHaveLength(BUILTIN_TEMPLATES.length);
  });

  it("keeps the first snippet when two share an abbreviation", () => {
    const out = resolveTemplates(
      [snip("snip-1", "first", "A", "x"), snip("snip-2", "second", "B", "X")],
      [],
    );
    expect(out).toEqual([{ abbr: "x", name: "first", body: "A" }]);
  });

  it("returns only the user's templates with built-ins disabled", () => {
    expect(resolveTemplates([snip("snip-1", "a", "A", "aa")], [])).toEqual([
      { abbr: "aa", name: "a", body: "A" },
    ]);
    expect(resolveTemplates([], [])).toEqual([]);
  });
});

describe("templateAt", () => {
  const list = [tpl("sel"), tpl("del")];

  it("finds the template whose abbreviation ends at the cursor", () => {
    expect(templateAt(list, "sel", 3)).toEqual({ template: list[0], from: 0 });
    expect(templateAt(list, "x; del", 6)).toEqual({ template: list[1], from: 3 });
  });

  it("matches case-insensitively", () => {
    expect(templateAt(list, "SEL", 3)?.template.abbr).toBe("sel");
  });

  it("needs the whole word", () => {
    expect(templateAt(list, "select", 6)).toBeNull(); // longer word
    expect(templateAt(list, "sel", 2)).toBeNull(); // cursor mid-word
    expect(templateAt(list, "xsel", 4)).toBeNull(); // word ends in it
    expect(templateAt(list, "selx", 3)).toBeNull(); // word goes on after the cursor
  });

  it("does not fire after a dot (a qualified column)", () => {
    expect(templateAt(list, "t.sel", 5)).toBeNull();
    expect(templateAt(list, ".sel", 4)).toBeNull();
  });

  it("returns null for an unknown word or an empty one", () => {
    expect(templateAt(list, "upd", 3)).toBeNull();
    expect(templateAt(list, "", 0)).toBeNull();
    expect(templateAt([], "sel", 3)).toBeNull();
  });
});

describe("templateToSnippet", () => {
  it("passes placeholders through untouched", () => {
    const body = "SELECT ${columns} FROM ${table} WHERE ${1:cond} ${}";
    expect(templateToSnippet(body)).toBe(body);
  });

  it("escapes braces that are SQL, not placeholders", () => {
    expect(templateToSnippet(`SELECT '{"a": 1}'`)).toBe(`SELECT '\\{"a": 1\\}'`);
    expect(templateToSnippet("x #{y} ${z}")).toBe("x #\\{y\\} ${z}");
  });

  it("keeps braces the author already escaped", () => {
    expect(templateToSnippet("SELECT $\\{raw\\}")).toBe("SELECT $\\{raw\\}");
  });

  it("leaves a body without braces as is", () => {
    expect(templateToSnippet("SELECT 1")).toBe("SELECT 1");
    expect(templateToSnippet("")).toBe("");
  });

  it("keeps every built-in's placeholders", () => {
    for (const b of BUILTIN_TEMPLATES) expect(templateToSnippet(b.body)).toBe(b.body);
  });
});
