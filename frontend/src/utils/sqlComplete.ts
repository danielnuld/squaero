// Contextual SQL completion (issue #661), built on the semantic scope (#660).
//
// lang-sql completes from a table -> columns map and a flat keyword list: it
// does not know that `o` is `orders`, that a CTE has columns, or that after
// `JOIN customers c ON` the useful thing to offer is the join condition. This
// answers "what fits HERE" from sqlScope's view of the statement, and returns
// null wherever it has nothing better, so the editor falls back to lang-sql.
//
// Pure: the editor maps the result straight onto a CodeMirror CompletionResult.

import { analyzeSql, lookupRelation, scopeAt, type Clause, type Relation } from "./sqlScope";
import type { EditorSchema } from "./sqlEditor";
import type { ForeignKeyRelation } from "./foreignKeys";
import { tokenizeSql, type SqlToken } from "./sqlTokens";
import { scanSql } from "./sqlTidy";
import { engineFamily } from "./engineFamily";
import { completionQuote, editorDialect } from "./sqlDialect";

export interface CompleteOptions {
  schema?: EditorSchema | null;
  /** Driver name: decides identifier quoting. */
  engine?: string | null;
  /** Real foreign keys of the tables in the statement, for JOIN … ON. */
  foreignKeys?: ForeignKeyRelation[];
  /** The user asked (Ctrl+Space): suggest even with nothing typed. */
  explicit?: boolean;
}

/** Shaped as a CodeMirror Completion. */
export interface Suggestion {
  label: string;
  type: "keyword" | "property" | "class" | "function" | "text";
  /** Text inserted instead of the label (a quoted name). */
  apply?: string;
  detail?: string;
  boost?: number;
}

export interface Completions {
  /** Where the replaced word starts; it ends at the cursor. */
  from: number;
  options: Suggestion[];
}

const JOINS = ["JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN"];
const PREDICATES = ["AND", "OR", "NOT", "IN", "IS NULL", "IS NOT NULL", "LIKE", "BETWEEN", "EXISTS"];
const FUNCTIONS = ["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CAST"];
const STATEMENT_START = ["SELECT", "WITH", "INSERT INTO", "UPDATE", "DELETE FROM", "CREATE", "ALTER", "DROP"];

/** Keywords that can follow at a position of each clause. */
const KEYWORDS: Partial<Record<Clause, string[]>> = {
  select: ["FROM", "DISTINCT", "AS", "CASE", "WHEN", "THEN", "ELSE", "END", "NULL"],
  from: [...JOINS, "AS", "WHERE", "GROUP BY", "ORDER BY", "UNION"],
  join: ["ON", "USING", "AS", ...JOINS, "WHERE"],
  on: [...PREDICATES, ...JOINS, "WHERE", "GROUP BY", "ORDER BY"],
  where: [...PREDICATES, "GROUP BY", "ORDER BY", "UNION"],
  "group-by": ["HAVING", "ORDER BY"],
  having: [...PREDICATES, "ORDER BY"],
  "order-by": ["ASC", "DESC"],
  set: ["WHERE"],
  update: ["SET"],
  delete: ["FROM"],
  insert: ["INTO"],
  into: ["VALUES", "SELECT"],
};

/** Clauses where a name is a column reference. */
const COLUMN_CLAUSES = new Set<Clause>(["select", "on", "using", "where", "group-by", "having", "order-by", "set", "into", "returning"]);

/** Clauses after which LIMIT reads well, on the engines that have it. */
const LIMIT_CLAUSES = new Set<Clause>(["from", "join", "on", "where", "group-by", "having", "order-by"]);
const LIMIT_FAMILIES = new Set(["mysql", "postgres", "sqlite"]);

/** Words after which a table name goes. */
const TABLE_AFTER = new Set(["from", "join", "into", "update", "table", "lateral"]);

const lc = (s: string) => s.toLowerCase();
const word = (t?: SqlToken) => (t && t.kind === "word" ? lc(t.value) : "");

/**
 * A name as it must be written: bare when the dialect reads it unchanged, else
 * in the engine's quotes — the rule lang-sql applies to its own completions, so
 * both agree. Informix delimits nothing (schema.ts#quoteIdentifier).
 */
export function completionName(name: string, engine?: string | null): string {
  const insensitive = editorDialect(engine).spec.caseInsensitiveIdentifiers;
  const plain = insensitive ? /^[a-z_][a-z0-9_]*$/i : /^[a-z_][a-z0-9_]*$/;
  if (plain.test(name) || engineFamily(engine ?? "") === "informix") return name;
  const open = completionQuote(engine);
  const close = open === "[" ? "]" : open;
  return open + name.split(close).join(close + close) + close;
}

/** True when `pos` is inside a string, comment or delimited name. */
function insideLiteral(sql: string, pos: number, engine: string): boolean {
  const quote = engineFamily(engine) === "mysql" ? "`" : '"';
  return scanSql(sql, quote).some((s) => {
    if (s.kind === "code" || pos <= s.start || pos > s.end) return false;
    if (pos < s.end) return true;
    // Right at its end: inside only while it is still open (a line comment
    // always is — its newline is not part of it).
    const text = sql.slice(s.start, s.end);
    if (s.kind === "comment") return !(text.startsWith("/*") && text.length > 3 && text.endsWith("*/"));
    return !(text.length > 1 && text.endsWith(text[0]));
  });
}

/**
 * Join conditions for the relation just joined, from the real foreign keys
 * between it and the relations before it, either direction. Composite keys
 * become one `a = b AND c = d` condition. Tables only: a CTE or subquery has
 * no catalog keys.
 */
export function joinConditions(
  joined: Relation,
  earlier: Relation[],
  fks: ForeignKeyRelation[],
  engine?: string | null,
): string[] {
  const bare = (r: Relation) => (r.target ?? "").split(".").pop()!;
  const same = (a: string, b: string) => lc(a) === lc(b);
  const q = (rel: Relation, col: string) => `${completionName(rel.name, engine)}.${completionName(col, engine)}`;
  const out = new Set<string>();
  if (joined.kind !== "table" || !joined.name) return [];
  for (const other of [...earlier].reverse()) {
    if (other.kind !== "table" || !other.name) continue;
    for (const fk of fks) {
      const pairs: [Relation, Relation][] = [];
      if (same(fk.fromTable, bare(joined)) && same(fk.toTable, bare(other))) pairs.push([joined, other]);
      if (same(fk.fromTable, bare(other)) && same(fk.toTable, bare(joined))) pairs.push([other, joined]);
      for (const [child, parent] of pairs) {
        if (fk.columns.length === 0) continue;
        out.add(fk.columns.map((c) => `${q(child, c.from)} = ${q(parent, c.to)}`).join(" AND "));
      }
    }
  }
  return [...out];
}

/**
 * What to suggest at `pos` in `sql`, or null when the semantic view has nothing
 * to add (inside a string or comment, `x.` on an unknown relation, a clause it
 * does not model) and lang-sql's completion should answer instead.
 */
export function sqlCompletions(sql: string, pos: number, options: CompleteOptions = {}): Completions | null {
  const engine = options.engine ?? "";
  if (insideLiteral(sql, pos, engine)) return null;
  let from = pos;
  while (from > 0 && /[\p{L}\p{N}_$]/u.test(sql[from - 1])) from--;
  const typed = sql.slice(from, pos);

  const tokens = tokenizeSql(sql, engine);
  let p = -1;
  for (let i = 0; i < tokens.length && tokens[i].end <= from; i++) p = i;
  const prev = tokens[p];

  const analysis = analyzeSql(sql, { schema: options.schema, engine });
  const cur = scopeAt(analysis, from);
  if (!cur) return null;
  const result = (opts: Suggestion[]) => (opts.length ? { from, options: opts } : null);

  // `alias.` → that relation's columns.
  if (prev?.text === "." && prev.end === from) {
    const q = tokens[p - 1];
    if (!q || q.end !== prev.start || (q.kind !== "word" && q.kind !== "quoted")) return null;
    const rel = lookupRelation(cur.scope, q.value);
    if (!rel?.columns) return null;
    return result(rel.columns.map((c) => column(c, rel.name, engine)));
  }

  const out: Suggestion[] = [];
  const clause = cur.clause;

  // Right after `JOIN t ON`: the whole condition, from the foreign keys.
  if (clause === "on") {
    const on = [...cur.scope.clauses].reverse().find((c) => c.clause === "on" && c.start <= from)!;
    const nothingYet = !tokens.some((t) => t.start >= on.start && t.end <= from);
    if (nothingYet) {
      const rels = cur.scope.relations;
      let j = -1;
      rels.forEach((r, i) => {
        const at = (r.alias ?? r.targetRange)?.start;
        if (at !== undefined && at < on.start) j = i;
      });
      if (j > 0) {
        for (const cond of joinConditions(rels[j], rels.slice(0, j), options.foreignKeys ?? [], engine)) {
          out.push({ label: cond, type: "text", detail: "FK", boost: 10 });
        }
      }
    }
  }
  if (!typed && !options.explicit) return result(out);

  const kws = (list: string[]) => {
    // Follow the case the user is typing in; upper case when nothing is typed.
    const lower = /^[a-z]/.test(typed);
    for (const k of list) out.push({ label: lower ? lc(k) : k, type: "keyword", boost: -1 });
  };

  const atStart = !prev || prev.end <= cur.statement.start || prev.text === ";";
  if (atStart) {
    kws(STATEMENT_START);
    return result(out);
  }

  const pw = word(prev);
  if (pw === "order" || pw === "group") {
    kws(["BY"]);
    return result(out);
  }
  const tablePos = TABLE_AFTER.has(pw) || (prev.text === "," && clause === "from");
  if (tablePos && ["from", "join", "into", "update", "delete", "other"].includes(clause)) {
    for (const t of options.schema?.tables ?? []) out.push({ label: t, apply: completionName(t, engine), type: "class" });
    for (const c of cur.ctes) out.push({ label: c.name, apply: completionName(c.name, engine), type: "class", detail: "CTE", boost: 1 });
    return result(out);
  }

  if (COLUMN_CLAUSES.has(clause)) {
    // A column present in several relations is offered qualified, once per
    // relation, so accepting it never writes an ambiguous reference.
    const owners = new Map<string, Set<Relation>>();
    for (const c of cur.columns) {
      const k = lc(c.name);
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k)!.add(c.relation);
    }
    const seen = new Set<string>();
    for (const c of cur.columns) {
      const shared = owners.get(lc(c.name))!.size > 1 && c.relation.name !== "";
      const s = shared ? column(c.name, c.relation.name, engine, true) : column(c.name, c.relation.name, engine);
      if (seen.has(lc(s.label))) continue;
      seen.add(lc(s.label));
      out.push(s);
    }
    for (const r of cur.relations) {
      if (r.name && !seen.has(lc(r.name))) {
        seen.add(lc(r.name));
        out.push({ label: r.name, apply: completionName(r.name, engine), type: "class", detail: r.target, boost: 1 });
      }
    }
    if (clause === "select" || clause === "having") {
      for (const f of FUNCTIONS) out.push({ label: f, type: "function" });
    }
  }
  kws(KEYWORDS[clause] ?? []);
  if (LIMIT_CLAUSES.has(clause) && LIMIT_FAMILIES.has(engineFamily(engine))) kws(["LIMIT"]);
  return result(out);
}

/** A column suggestion; `qualified` writes it as `rel.col`. */
function column(name: string, rel: string, engine: string, qualified = false): Suggestion {
  const apply = completionName(name, engine);
  if (qualified) {
    return { label: `${rel}.${name}`, apply: `${completionName(rel, engine)}.${apply}`, type: "property", boost: 2 };
  }
  return { label: name, apply: apply === name ? undefined : apply, type: "property", detail: rel || undefined, boost: 2 };
}

/**
 * The i18n key of what a completion IS, shown in words beside it (M14
 * EditorAutocomplete: «tabla», «columna», «función»…) instead of a coloured
 * glyph that has to be learnt. Covers lang-sql's own kinds too (a schema table
 * comes from it as "type"); null for a kind with nothing useful to say.
 */
export function completionKind(c: { type?: string; detail?: string }): string | null {
  switch (c.type) {
    case "keyword":
      return "complete.kind.keyword";
    case "class":
      return c.detail === "CTE" ? "complete.kind.cte" : "complete.kind.table";
    case "type":
      return "complete.kind.table";
    case "property":
      return "complete.kind.column";
    case "function":
    case "method":
      return "complete.kind.function";
    case "text":
      return c.detail === "FK" ? "complete.kind.join" : null;
    default:
      return null;
  }
}

/**
 * What the info pane beside a table completion lists: its columns, as the
 * schema knows them. Matched as written, then case-insensitively. Null when the
 * table's columns are not known yet — nothing is guessed.
 */
export function tableColumns(schema: EditorSchema | null | undefined, table: string): string[] | null {
  const cols = schema?.columns;
  if (!cols) return null;
  if (cols[table]) return cols[table];
  const lower = table.toLowerCase();
  const key = Object.keys(cols).find((k) => k.toLowerCase() === lower);
  return key ? cols[key] : null;
}
