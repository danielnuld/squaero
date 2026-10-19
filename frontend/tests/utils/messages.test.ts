// Guard over the message catalogs (#695): the texts follow the tone and the
// glossary in docs/GLOSSARY.md. A rule names the banned pattern; a value that
// needs an exception is allowlisted by key, with the reason next to it.
import { describe, it, expect } from "vitest";
import { es } from "../../src/utils/messages/es";
import { en } from "../../src/utils/messages/en";

interface Rule {
  name: string;
  test: RegExp;
  /** Keys exempt from this rule, with the reason. */
  allow?: string[];
}

// Values glued to a neighbour at render time keep their edge space on purpose.
const FRAGMENTS = [
  "result.pagingPaused",
  "er.listIncomplete",
  "er.inferredMid",
  "er.realMid",
  "nb.paramsHintPre",
  "nb.paramsHintPost",
  "nb.truncatedSuffix",
  "hist.slowTag",
];

// Quotes an XML attribute literally (null="true"); typographic quotes would lie.
const XML_LITERAL = ["ios.export.desc.xml"];

// Names the SQL statement it generates (DROP TABLE).
const SQL_DROP = ["ssync.dropTables", "ssync.issue.dropTableSkipped"];
// The name of a grid style, not a word for a row.
const STYLE_NAME = ["settings.gridStyle.registro"];
// Quotes the "!" the grid draws on those rows.
const LITERAL_MARK = ["compare.duplicates"];

const SHARED: Rule[] = [
  { name: "exclamation mark", test: /[!¡]/, allow: LITERAL_MARK },
  { name: "three dots instead of the ellipsis character", test: /\.\.\./ },
  { name: "double space", test: / {2,}/ },
  { name: "edge whitespace", test: /^\s|\s$/, allow: FRAGMENTS },
  { name: "decorative emoji or symbol", test: /[\p{Extended_Pictographic}▶⟳✓✔✗]/u },
];

const ES: Rule[] = [
  ...SHARED,
  { name: "filler word", test: /\b(simplemente|fácilmente|potente|ups|listo|genial)\b/i },
  { name: "glossary: use «clave», not «llave»", test: /\bllaves?\b/i },
  { name: "glossary: use «fila», not «registro»", test: /\bregistros?\b/i, allow: STYLE_NAME },
  { name: "glossary: use «eliminar», not «borrar»", test: /\bborra(r|do|da|dos|das)?\b/i },
  { name: "glossary: use «añadir», not «agregar»", test: /\bagregar\b/i },
  { name: "glossary: use «permiso», not «privilegio»", test: /\bprivilegios?\b/i },
  { name: "glossary: use «refrescar», not «actualizar», for refresh", test: /\bactualizando\b/i },
  { name: "glossary: use «aún», not «todavía»", test: /\btodavía\b/i },
  { name: "spelling: «solo» takes no accent", test: /\bsólo\b/i },
  { name: "quotes: use «…», not \"…\"", test: /"/, allow: XML_LITERAL },
];

const EN: Rule[] = [
  ...SHARED,
  { name: "filler word", test: /\b(simply|easily|powerful|oops|awesome)\b/i },
  { name: "spelling: US English", test: /\b(colour|favourite|cancelled)/i },
  { name: "glossary: use “choose”, not “pick”", test: /\bpick\b/i },
  { name: "glossary: use “row”, not “record”", test: /\brecords?\b/i, allow: STYLE_NAME },
  { name: "glossary: use “delete”, not “drop”", test: /\bdrop\b/i, allow: SQL_DROP },
  // lower-case only: "ORDER BY" names the SQL clause and stays
  { name: "glossary: use “sort by”, not “order by”", test: /\b[Oo]rder by\b/ },
  { name: "glossary: use “run again”, not “re-run”", test: /\bre-run\b/i },
  { name: "quotes: use “…”, not \"…\"", test: /"/, allow: XML_LITERAL },
];

// Key names are formatted per platform and language (formatKeys, R-33): a
// message takes them as {keys}-style placeholders, never spelled out.
const KEY_NAMES: Rule = {
  name: "key names belong in a {keys} placeholder (formatKeys)",
  test: /\b(Ctrl|Cmd|Mayús|Shift|Intro|Enter|Supr)\b|⌘/,
};
ES.push(KEY_NAMES);
EN.push(KEY_NAMES);

function violations(catalog: Record<string, string>, rules: Rule[]): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(catalog)) {
    for (const r of rules) {
      if (r.allow?.includes(key)) continue;
      if (r === KEY_NAMES && key.startsWith("key.")) continue;
      if (r.test.test(value)) out.push(`${key}: ${r.name} — ${JSON.stringify(value)}`);
    }
  }
  return out;
}

describe("message catalog guard", () => {
  it("es follows the tone and glossary rules", () => {
    expect(violations(es, ES)).toEqual([]);
  });
  it("en follows the tone and glossary rules", () => {
    expect(violations(en, EN)).toEqual([]);
  });
  it("every allowlisted key still exists (no stale exceptions)", () => {
    const keys = new Set([...Object.keys(es), ...Object.keys(en)]);
    const stale = [...ES, ...EN].flatMap((r) => r.allow ?? []).filter((k) => !keys.has(k));
    expect(stale).toEqual([]);
  });
});
