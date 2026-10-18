// Problems in the editor's SQL, found before it runs (issue #662).
//
// Each rule is a pure function over the semantic analysis (#660). They only
// mark — execution is never blocked — and they would rather stay silent than be
// wrong: anything that depends on what is not loaded (a table never described,
// a relation whose columns are partial) resolves as `unresolved` upstream and is
// never flagged here.

import { analyzeSql, visibleRelations, type Reference, type SqlAnalysis } from "./sqlScope";
import type { EditorSchema } from "./sqlEditor";
import { tokenizeSql, type SqlToken } from "./sqlTokens";

export interface SqlDiagnostic {
  from: number;
  /** Exclusive. */
  to: number;
  severity: "error" | "warning";
  /** i18n key of the message. */
  messageKey: string;
  params?: Record<string, string | number>;
}

export interface DiagnoseOptions {
  schema?: EditorSchema | null;
  engine?: string | null;
  /**
   * Tables confirmed absent (lower case): the editor tried to describe them and
   * got nothing. When given, an unknown table must be in it to be flagged — the
   * table list the editor holds is only what the object tree has loaded, so
   * "not in the list" alone is not proof.
   */
  missingTables?: ReadonlySet<string>;
}

/** Row identifiers every engine of its kind has without declaring them. */
const PSEUDO_COLUMNS = new Set(["rowid", "_rowid_", "oid", "ctid", "xmin", "xmax", "cmin", "cmax", "tableoid", "level"]);

const lc = (s: string) => s.toLowerCase();
const refs = (a: SqlAnalysis) => a.statements.flatMap((s) => s.references);

/** Names the document itself creates (CREATE [TEMP] TABLE/VIEW x): a script
    that creates then reads a table must not be told it does not exist. */
function createdNames(tokens: SqlToken[]): Set<string> {
  const out = new Set<string>();
  tokens.forEach((t, i) => {
    if (lc(t.value) !== "create" || t.kind !== "word") return;
    let j = i + 1;
    while (j < tokens.length && j < i + 6 && !["table", "view"].includes(lc(tokens[j].value))) j++;
    if (j >= tokens.length || j >= i + 6) return;
    j++;
    if (lc(tokens[j]?.value ?? "") === "if") j += 3; // IF NOT EXISTS
    while (tokens[j + 1]?.text === "." && tokens[j + 2]) j += 2;
    if (tokens[j]) out.add(lc(tokens[j].value));
  });
  return out;
}

/** A FROM/JOIN/target table that is not in the loaded schema. */
export function unknownTables(analysis: SqlAnalysis, tokens: SqlToken[], missing?: ReadonlySet<string>): SqlDiagnostic[] {
  const created = createdNames(tokens);
  return refs(analysis)
    .filter((r) => r.role === "relation" && r.resolution === "unknown")
    .filter((r) => !created.has(lc(r.name)) && (!missing || missing.has(lc(r.name))))
    .map((r) => diag(r, "error", "diag.unknownTable"));
}

/** A column its relation(s), fully known, do not have. */
export function unknownColumns(analysis: SqlAnalysis): SqlDiagnostic[] {
  return refs(analysis)
    .filter((r) => r.role === "column" && r.resolution === "unknown" && !PSEUDO_COLUMNS.has(lc(r.name)))
    .map((r) => diag(r, "error", "diag.unknownColumn"));
}

/** An unqualified column that more than one relation of its level has. */
export function ambiguousColumns(analysis: SqlAnalysis): SqlDiagnostic[] {
  return refs(analysis)
    .filter((r) => r.role === "column" && r.resolution === "ambiguous")
    .map((r) => {
      const has = (rels: typeof r.scope.relations) =>
        rels.filter((x) => x.columns?.some((c) => lc(c) === lc(r.name))).map((x) => x.name || "?");
      const own = has(r.scope.relations);
      const tables = own.length > 1 ? own : has(visibleRelations(r.scope));
      return diag(r, "error", "diag.ambiguousColumn", { tables: tables.join(", ") });
    });
}

/** UPDATE or DELETE with no WHERE: it touches every row. A warning, not an
    error — sometimes that is the point. */
export function unfilteredWrites(analysis: SqlAnalysis): SqlDiagnostic[] {
  const out: SqlDiagnostic[] = [];
  for (const s of analysis.statements) {
    const root = s.scopes[0];
    const verb = root?.clauses.find((c) => c.clause !== "with");
    if (!verb || (verb.clause !== "update" && verb.clause !== "delete")) continue;
    if (root.clauses.some((c) => c.clause === "where")) continue;
    out.push({
      from: verb.start - verb.clause.length,
      to: verb.start,
      severity: "warning",
      messageKey: verb.clause === "update" ? "diag.updateWithoutWhere" : "diag.deleteWithoutWhere",
    });
  }
  return out;
}

/** INSERT whose VALUES rows do not have as many values as its column list. */
export function insertArity(analysis: SqlAnalysis, tokens: SqlToken[]): SqlDiagnostic[] {
  const out: SqlDiagnostic[] = [];
  const w = (t?: SqlToken) => (t?.kind === "word" ? lc(t.value) : "");
  for (const s of analysis.statements) {
    const toks = tokens.filter((t) => t.start >= s.start && t.end <= s.end);
    let i = toks.findIndex((t) => w(t) === "insert" || w(t) === "replace");
    if (i < 0 || (w(toks[i]) === "replace" && i > 0)) continue;
    while (i < toks.length && w(toks[i]) !== "into") i++;
    i++;
    // The target name, dotted parts included.
    while (i < toks.length && toks[i].text !== "(" && w(toks[i]) !== "values") i++;
    if (toks[i]?.text !== "(") continue;
    const list = group(toks, i);
    if (!list) continue;
    const columns = list.items;
    i = list.close + 1;
    if (w(toks[i]) !== "values" && w(toks[i]) !== "value") continue;
    i++;
    while (toks[i]?.text === "(") {
      const row = group(toks, i);
      if (!row) break;
      if (row.items !== columns) {
        out.push({
          from: toks[i].start,
          to: toks[row.close].end,
          severity: "error",
          messageKey: "diag.insertArity",
          params: { values: row.items, columns },
        });
      }
      i = row.close + 1;
      if (toks[i]?.text !== ",") break;
      i++;
    }
  }
  return out;
}

/** The parenthesized group opening at toks[open]: its closing index and how
    many top-level items it holds. Null when it is not closed yet. */
function group(toks: SqlToken[], open: number): { close: number; items: number } | null {
  let depth = 0;
  let commas = 0;
  for (let i = open; i < toks.length; i++) {
    const t = toks[i].text;
    if (t === "(") depth++;
    else if (t === ")" && --depth === 0) return { close: i, items: i === open + 1 ? 0 : commas + 1 };
    else if (t === "," && depth === 1) commas++;
  }
  return null;
}

function diag(r: Reference, severity: SqlDiagnostic["severity"], messageKey: string, extra?: Record<string, string>): SqlDiagnostic {
  return { from: r.start, to: r.end, severity, messageKey, params: { name: r.name, ...extra } };
}

/** Every rule over `sql`, in document order. */
export function sqlDiagnostics(sql: string, options: DiagnoseOptions = {}): SqlDiagnostic[] {
  const analysis = analyzeSql(sql, { schema: options.schema, engine: options.engine });
  const tokens = tokenizeSql(sql, options.engine);
  return [
    ...unknownTables(analysis, tokens, options.missingTables),
    ...unknownColumns(analysis),
    ...ambiguousColumns(analysis),
    ...unfilteredWrites(analysis),
    ...insertArity(analysis, tokens),
  ].sort((a, b) => a.from - b.from);
}
