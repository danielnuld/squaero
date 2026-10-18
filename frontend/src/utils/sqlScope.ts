// Semantic scope of the SQL in the editor (issue #660).
//
// Contextual completion (#661), diagnostics (#662), go-to-definition (#663)
// and rename (#664) all ask the same question first: at this point of the
// document, which relations exist, under what names, with which columns, and
// what does this identifier refer to? This answers it once, purely, from the
// text plus whatever schema the editor has loaded.
//
// It is a tolerant recursive-descent pass over sqlTokens, not a grammar. The
// user is typing, so the SQL is broken most of the time — an unclosed paren, a
// trailing JOIN, `alias.` with nothing after — and the pass never throws: it
// keeps what it understood and stops where it could not go on.
//
// "Unresolved, never wrong": whenever the answer depends on something unknown
// (a table whose columns were not described, a select item with no derivable
// name, a routine body), the reference is `unresolved` rather than `unknown`,
// so a diagnostic built on top never flags valid SQL.
//
// Offsets are UTF-16 indices into the ORIGINAL document, the same CodeMirror
// uses, so a rename edits exactly [start, end).

import { splitStatements } from "./runScope";
import type { EditorSchema } from "./sqlEditor";
import { RESERVED } from "./sqlTidy";
import { engineFamily } from "./engineFamily";
import { tokenizeSql, type SqlToken } from "./sqlTokens";

/** A half-open span of the document. */
export interface Range {
  start: number;
  /** Exclusive. */
  end: number;
}

/** The clause a position belongs to, to pick keywords and candidates (#661). */
export type Clause =
  | "with"
  | "select"
  | "from"
  | "join"
  | "on"
  | "using"
  | "where"
  | "group-by"
  | "having"
  | "order-by"
  | "window"
  | "limit"
  | "insert"
  | "into"
  | "values"
  | "update"
  | "set"
  | "delete"
  | "returning"
  /** Before any clause, or in a statement this does not model (DDL…). */
  | "other";

export type RelationKind = "table" | "cte" | "subquery" | "function";

/** A relation declared in a FROM/JOIN/UPDATE/INSERT/DELETE target. */
export interface Relation {
  kind: RelationKind;
  /** The name it is referred to by: the alias, else the last part of the
      target name. Empty for a derived table with no alias. */
  name: string;
  /** Table, CTE or function name as written, unquoted, parts joined by `.`.
      Absent for a derived table. */
  target?: string;
  /** Span of the target's last name part (the table or CTE name token). */
  targetRange?: Range;
  /** Span of the alias declaration. Its declaration is `alias ?? targetRange`. */
  alias?: Range;
  /** Its columns, or null when unknown (table not described, …). */
  columns: string[] | null;
  /** False when `columns` may be missing some (a select item with no
      derivable name, a `*` over an undescribed table). */
  columnsComplete: boolean;
  /** The CTE it reads, for kind "cte". */
  cte?: Cte;
  /** The derived table's body, for kind "subquery". */
  body?: Scope;
  /** The scope that declares it. */
  scope: Scope;
}

/** A common table expression declared by WITH. */
export interface Cte {
  name: string;
  /** Span of the name in its declaration. */
  range: Range;
  recursive: boolean;
  /** The explicit `WITH x(a, b)` list, else the body's output; null if unknown. */
  columns: string[] | null;
  columnsComplete: boolean;
  /** The body query (its first branch), or null when not typed yet. */
  body: Scope | null;
  /** Where the name can be referenced: after its body (from its own name when
      recursive) to the end of the query that declares it. */
  visible: Range;
}

/** One SELECT block (one branch of a UNION), or a DML statement's own level. */
export interface Scope {
  start: number;
  /** Exclusive-ish: a cursor exactly at `end` still belongs to the scope. */
  end: number;
  parent: Scope | null;
  /** True when the outer relations are visible (a subquery in WHERE/SELECT/ON,
      LATERAL, APPLY). A derived table or CTE body skips its parent's FROM. */
  correlated: boolean;
  relations: Relation[];
  /** Clause keywords in order, `start` being the keyword's end offset. */
  clauses: { clause: Clause; start: number }[];
  /** The select list's output names, or null when it has none known. */
  columns: string[] | null;
  columnsComplete: boolean;
}

export type Resolution =
  | RelationKind
  | "column"
  /** An unqualified column found in more than one relation of the same level. */
  | "ambiguous"
  /** Definitely not there: everything it could name is fully known. */
  | "unknown"
  /** Cannot tell: the schema or the relation's columns are not known. */
  | "unresolved";

/** An identifier in the statement and what it names. */
export interface Reference extends Range {
  /** Unquoted text of the identifier. */
  name: string;
  /** relation: a FROM/JOIN target name; qualifier: the `a` of `a.col` (or of
      a trailing `a.`); column: a column name, qualified or not. */
  role: "relation" | "qualifier" | "column";
  resolution: Resolution;
  /** relation: the relation it declares; qualifier: the relation it names;
      column: the relation owning the column (absent for a select alias). */
  relation?: Relation;
  /** The CTE a relation reference reads. */
  cte?: Cte;
  scope: Scope;
  clause: Clause;
}

export interface StatementAnalysis extends Range {
  /** Every scope; the first is the statement's root. */
  scopes: Scope[];
  ctes: Cte[];
  /** In document order. */
  references: Reference[];
}

export interface SqlAnalysis {
  statements: StatementAnalysis[];
}

export interface AnalyzeOptions {
  /** What the editor knows of the schema; partial or absent is fine. */
  schema?: EditorSchema | null;
  /** Driver name: decides identifier quoting and statement splitting. */
  engine?: string | null;
}

/** What is in scope at a cursor position. */
export interface CursorScope {
  statement: StatementAnalysis;
  /** The innermost scope holding the cursor. */
  scope: Scope;
  clause: Clause;
  /** Visible relations, innermost level first. */
  relations: Relation[];
  /** Known columns of those relations. */
  columns: { name: string; relation: Relation }[];
  /** CTEs that can be named here. */
  ctes: Cte[];
}

// Words that are not column references even though no engine reserves them.
// ponytail: date-part words (year, month…) are skipped everywhere so EXTRACT
// does not report them; a real column named `month` is then simply not seen.
const NOT_A_COLUMN = new Set(
  (
    "first last skip top next percent ties preceding following unbounded within " +
    "escape at zone nocase today sysdate systimestamp rownum materialized minus " +
    "apply qualify year month day hour minute second epoch week quarter dow doy"
  ).split(" "),
);

/** Words that end a FROM item rather than alias it, beyond RESERVED. */
const ALIAS_STOP = new Set(["minus", "apply", "qualify", "pivot", "unpivot", "sample", "start", "connect"]);

/** Row qualifiers of triggers and upserts: never a relation of the query. */
const PSEUDO_QUALIFIERS = new Set(["new", "old", "excluded", "inserted", "deleted"]);

/** Clauses whose identifiers are column references. */
const REF_CLAUSES: ReadonlySet<Clause> = new Set<Clause>([
  "select", "on", "using", "where", "group-by", "having", "order-by", "window",
  "into", "values", "set", "returning",
]);

const FROM_CLAUSES: ReadonlySet<Clause> = new Set<Clause>(["from", "join", "on", "using"]);

const SET_OPERATORS = new Set(["union", "intersect", "except", "minus"]);

const lc = (s: string) => s.toLowerCase();
const kw = (t?: SqlToken) => (t && t.kind === "word" ? lc(t.value) : "");
const isPart = (t?: SqlToken) => !!t && (t.kind === "word" || t.kind === "quoted");
/** A token that can name a table: quoted, or a word no engine reserves. */
const relName = (t?: SqlToken) => !!t && (t.kind === "quoted" || (t.kind === "word" && !RESERVED.has(lc(t.value))));
const aliasName = (t?: SqlToken) => relName(t) && !ALIAS_STOP.has(kw(t));
const colName = (t?: SqlToken) => relName(t) && !NOT_A_COLUMN.has(kw(t));
/** A token that can end an expression, so a name right after it is an alias. */
const exprEnd = (t?: SqlToken) =>
  !!t &&
  (colName(t) ||
    t.kind === "number" ||
    t.kind === "string" ||
    t.text === ")" ||
    ["end", "null", "true", "false"].includes(kw(t)));

const sameName = (a: string, b: string) => lc(a) === lc(b);

/** A select-list item, reduced to what its output column is called. */
type Item = { named: string } | { star: string | null } | { anonymous: true };

interface ScopeState {
  hasSelect: boolean;
  items: Item[];
  natural: boolean;
  using: Set<string>;
}

interface PendingRef {
  ref: Reference;
  /** For a column: the qualifier's name, when qualified. */
  qualifier?: string;
  /** SET's left-hand side: only the UPDATE target can own it. */
  targetOnly?: boolean;
  /** For a relation reference: the dotted target name. */
  target?: string;
}

/**
 * Analyze every statement of `sql`. Never throws, whatever the text.
 */
export function analyzeSql(sql: string, options: AnalyzeOptions = {}): SqlAnalysis {
  const engine = options.engine ?? "";
  const tokens = tokenizeSql(sql, engine);
  const statements: StatementAnalysis[] = [];
  let k = 0;
  for (const s of splitStatements(sql, engine)) {
    const own: SqlToken[] = [];
    while (k < tokens.length && tokens[k].start < s.to) {
      if (tokens[k].start >= s.from) own.push(tokens[k]);
      k++;
    }
    statements.push(analyzeStatement(own, s.from, s.to, options.schema ?? null, engineFamily(engine)));
  }
  return { statements };
}

function analyzeStatement(
  toks: SqlToken[],
  stmtStart: number,
  stmtEnd: number,
  schema: EditorSchema | null,
  family: string,
): StatementAnalysis {
  const scopes: Scope[] = [];
  const ctes: Cte[] = [];
  const pending: PendingRef[] = [];
  const state = new Map<Scope, ScopeState>();
  /** Relations whose columns an alias list fixed (`AS x(a, b)`). */
  const fixedColumns = new Set<Relation>();
  const out: StatementAnalysis = { start: stmtStart, end: stmtEnd, scopes, ctes, references: [] };

  const newScope = (parent: Scope | null, correlated: boolean, start: number, end: number): Scope => {
    const scope: Scope = {
      start, end, parent, correlated, relations: [], clauses: [], columns: null, columnsComplete: false,
    };
    scopes.push(scope);
    state.set(scope, { hasSelect: false, items: [], natural: false, using: new Set() });
    return scope;
  };

  // A routine's body is procedural code: its NEW.x and variables are not
  // relations, and modelling it would only produce wrong answers.
  const head = toks.slice(0, 8).map(kw);
  if (["create", "alter", "replace"].includes(head[0]) &&
      head.some((w) => ["procedure", "function", "trigger", "event", "package"].includes(w))) {
    newScope(null, false, stmtStart, stmtEnd);
    return out;
  }

  // Matching parenthesis of every "(", or -1 when unclosed.
  const match = new Array<number>(toks.length).fill(-1);
  const open: number[] = [];
  toks.forEach((t, i) => {
    if (t.text === "(") open.push(i);
    else if (t.text === ")" && open.length) match[open.pop()!] = i;
  });
  const closeOf = (i: number, stop: number) => (match[i] !== -1 && match[i] < stop ? match[i] : stop);

  let pos = 0;

  /** After a ".", the next name part. A reserved word counts only when glued
      to the dot (`t.order`): with a space it is the next clause, as in an
      `alias.` still being typed before FROM. */
  const partAfterDot = (i: number, stop: number) =>
    i < stop && (toks[i].kind === "quoted" || (toks[i].kind === "word" && (relName(toks[i]) || toks[i].start === toks[i - 1].end)));

  /** Read `( name, name … )` at pos, returning the names; pos ends after it. */
  const nameList = (stop: number): string[] => {
    const c = closeOf(pos, stop);
    const names: string[] = [];
    for (let i = pos + 1; i < c; i++) {
      if (isPart(toks[i]) && (toks[i - 1].text === "(" || toks[i - 1].text === ",")) names.push(toks[i].value);
    }
    pos = c < stop ? c + 1 : stop;
    return names;
  };

  /** Parse a query block (with its UNION branches) in toks[pos, stop). */
  function parseQuery(stop: number, parent: Scope | null, correlated: boolean, start: number, end: number): Scope {
    const first = newScope(parent, correlated, start, end);
    let scope = first;
    let st = state.get(scope)!;
    let clause = "other" as Clause;
    let expectRel = false;
    let lateral = false;
    const parens: ("expr" | "group")[] = [];
    let exprDepth = 0;
    let item: number[] | null = null;

    const finishItem = () => {
      if (item && item.length) st.items.push(describeItem(item, st.items.length === 0));
      item = null;
    };
    const setClause = (c: Clause, at: number) => {
      finishItem();
      clause = c;
      scope.clauses.push({ clause: c, start: at });
    };
    const opened = () => scope.clauses.some((c) => c.clause !== "with");
    const track = (...idx: number[]) => {
      if (item && exprDepth === 0) item.push(...idx);
    };

    const declare = (rel: Omit<Relation, "scope" | "columns" | "columnsComplete">, aliasCols: string[] | null) => {
      const full: Relation = { ...rel, scope, columns: aliasCols, columnsComplete: aliasCols !== null };
      if (aliasCols) fixedColumns.add(full);
      scope.relations.push(full);
      return full;
    };

    /** The alias after a FROM item, and its optional column list. */
    const readAlias = (): { alias?: SqlToken; cols: string[] | null } => {
      if (pos >= stop) return { cols: null };
      if (kw(toks[pos]) === "as") pos++;
      let alias: SqlToken | undefined;
      if (pos < stop && aliasName(toks[pos])) alias = toks[pos++];
      const cols = alias && pos < stop && toks[pos].text === "(" ? nameList(stop) : null;
      return { alias, cols };
    };

    /** A FROM/JOIN/target item at pos (pos is on a name or a subquery's "("). */
    const parseRelation = () => {
      const t = toks[pos];
      if (t.text === "(") {
        const c = closeOf(pos, stop);
        pos++;
        const body = parseQuery(c, scope, lateral, t.end, c < stop ? toks[c].start : end);
        pos = c < stop ? c + 1 : stop;
        const { alias, cols } = readAlias();
        declare(
          { kind: "subquery", name: alias?.value ?? "", body, alias: alias && range(alias) },
          cols,
        );
        return;
      }
      const parts = [t];
      pos++;
      while (pos < stop && toks[pos].text === ".") {
        if (partAfterDot(pos + 1, stop)) {
          parts.push(toks[pos + 1]);
          pos += 2;
        } else {
          pos++;
          break;
        }
      }
      const last = parts[parts.length - 1];
      const target = parts.map((p) => p.value).join(".");
      if (pos < stop && toks[pos].text === "(" && (clause === "from" || clause === "join")) {
        // A table function: its arguments are skipped, not modelled.
        const c = closeOf(pos, stop);
        pos = c < stop ? c + 1 : stop;
        const { alias, cols } = readAlias();
        declare(
          { kind: "function", name: alias?.value ?? last.value, target, targetRange: range(last), alias: alias && range(alias) },
          cols,
        );
        return;
      }
      const { alias, cols } = readAlias();
      const rel = declare(
        { kind: "table", name: alias?.value ?? last.value, target, targetRange: range(last), alias: alias && range(alias) },
        cols,
      );
      pending.push({
        ref: { ...range(last), name: last.value, role: "relation", resolution: "unresolved", relation: rel, scope, clause },
        target,
      });
    };

    /** An identifier chain at pos: a column, `q.col`, `s.t.col`, or `q.`. */
    const parseIdent = () => {
      const from = pos;
      const parts = [toks[pos]];
      let trailingDot = false;
      pos++;
      while (pos < stop && toks[pos].text === ".") {
        if (partAfterDot(pos + 1, stop)) {
          parts.push(toks[pos + 1]);
          pos += 2;
        } else {
          trailingDot = true;
          pos++;
          break;
        }
      }
      const indices = Array.from({ length: pos - from }, (_, i) => from + i);
      // `.*` belongs to the select item, not to the reference.
      if (trailingDot && pos < stop && toks[pos].text === "*") indices.push(pos++);
      const prev = toks[from - 1];
      const isCall = !trailingDot && pos < stop && toks[pos].text === "(";
      const isAliasDecl =
        kw(prev) === "as" ||
        prev?.text === "::" ||
        (clause === "select" && exprDepth === 0 && parts.length === 1 && item !== null && endsExpression(item, st.items.length === 0));
      track(...indices);
      if (isCall || isAliasDecl || !REF_CLAUSES.has(clause)) return;

      const base = { resolution: "unresolved" as Resolution, scope, clause };
      if (trailingDot || parts.length > 1) {
        const q = trailingDot ? parts[parts.length - 1] : parts[parts.length - 2];
        pending.push({ ref: { ...range(q), name: q.value, role: "qualifier", ...base } });
      }
      if (!trailingDot) {
        const c = parts[parts.length - 1];
        if (clause === "using") st.using.add(lc(c.value));
        const next = toks[pos];
        const targetOnly =
          clause === "set" && exprDepth === 0 && next?.text === "=" &&
          (prev?.text === "," || kw(prev) === "set" || kw(prev) === "update");
        pending.push({
          ref: { ...range(c), name: c.value, role: "column", ...base },
          qualifier: parts.length > 1 ? parts[parts.length - 2].value : undefined,
          targetOnly,
        });
      }
    };

    while (pos < stop) {
      const t = toks[pos];
      const word = kw(t);

      if (t.text === "(") {
        const inner = kw(toks[pos + 1]);
        if (expectRel && (inner === "select" || inner === "with" || inner === "values")) {
          parseRelation();
          expectRel = lateral = false;
          continue;
        }
        if (inner === "select" || inner === "with") {
          const c = closeOf(pos, stop);
          track(pos);
          if (c < stop) track(c);
          pos++;
          parseQuery(c, scope, true, t.end, c < stop ? toks[c].start : end);
          pos = c < stop ? c + 1 : stop;
          continue;
        }
        if (expectRel) {
          parens.push("group");
        } else {
          track(pos);
          parens.push("expr");
          exprDepth++;
        }
        pos++;
        continue;
      }
      if (t.text === ")") {
        if (parens.pop() === "expr") {
          exprDepth--;
          track(pos);
        }
        pos++;
        continue;
      }
      if (exprDepth > 0) {
        if (isPart(t) && (t.kind === "quoted" || colName(t))) parseIdent();
        else pos++;
        continue;
      }

      if (expectRel) {
        if (word === "lateral") {
          lateral = true;
          pos++;
          continue;
        }
        if (relName(t)) {
          parseRelation();
          expectRel = lateral = false;
          continue;
        }
        expectRel = lateral = false;
      }

      switch (word) {
        case "with":
          if (!opened()) {
            parseWith(scope, stop, end);
            continue;
          }
          if (clause === "insert" || clause === "into") {
            parseQuery(stop, scope, false, t.start, end);
            continue;
          }
          break;
        case "select":
          if (opened()) {
            // INSERT … SELECT, CREATE … AS SELECT after a target: its own level,
            // so the target does not leak into the query's names.
            parseQuery(stop, scope, false, t.start, end);
            continue;
          }
          setClause("select", t.end);
          st.hasSelect = true;
          item = [];
          pos++;
          continue;
        case "from":
          setClause("from", t.end);
          expectRel = true;
          pos++;
          continue;
        case "join":
          setClause("join", t.end);
          expectRel = true;
          pos++;
          continue;
        case "apply":
          setClause("join", t.end);
          expectRel = lateral = true;
          pos++;
          continue;
        case "natural":
          st.natural = true;
          break;
        case "on":
          if (clause === "select") break; // DISTINCT ON (…)
          setClause(clause === "join" ? "on" : "other", t.end);
          pos++;
          continue;
        case "using":
          if (clause === "join") setClause("using", t.end);
          else {
            setClause("from", t.end);
            expectRel = true;
          }
          pos++;
          continue;
        case "where":
        case "having":
        case "window":
        case "returning":
        case "values":
          setClause(word as Clause, t.end);
          pos++;
          continue;
        case "group":
        case "order":
          if (kw(toks[pos + 1]) === "by") pos++;
          setClause(word === "group" ? "group-by" : "order-by", toks[pos].end);
          pos++;
          continue;
        case "limit":
        case "offset":
        case "fetch":
          setClause("limit", t.end);
          pos++;
          continue;
        case "into":
          if (st.hasSelect) setClause("other", t.end);
          else {
            setClause("into", t.end);
            expectRel = true;
          }
          pos++;
          continue;
        case "insert":
          if (opened()) break;
          setClause("insert", t.end);
          expectRel = true;
          pos++;
          continue;
        case "update":
          if (!opened()) {
            setClause("update", t.end);
            expectRel = true;
          } else {
            // FOR UPDATE locks; ON DUPLICATE KEY / DO UPDATE assigns.
            setClause(kw(toks[pos - 1]) === "for" ? "other" : "set", t.end);
          }
          pos++;
          continue;
        case "set":
          setClause(scope.clauses.some((c) => ["update", "insert", "set"].includes(c.clause)) ? "set" : "other", t.end);
          pos++;
          continue;
        case "delete":
          if (opened()) break;
          setClause("delete", t.end);
          pos++;
          continue;
        default:
          if (SET_OPERATORS.has(word) && parens.length === 0) {
            finishItem();
            scope.end = t.start;
            pos++;
            if (["all", "distinct"].includes(kw(toks[pos]))) pos++;
            scope = newScope(parent, correlated, toks[pos - 1].end, end);
            st = state.get(scope)!;
            clause = "other";
            continue;
          }
      }

      if (t.text === ",") {
        if (FROM_CLAUSES.has(clause)) {
          setClause("from", t.end);
          expectRel = true;
        } else if (clause === "select") {
          finishItem();
          item = [];
        }
        pos++;
        continue;
      }
      if (isPart(t) && (t.kind === "quoted" || colName(t))) parseIdent();
      else {
        track(pos);
        pos++;
      }
    }
    finishItem();
    return first;
  }

  /** WITH [RECURSIVE] name [(cols)] AS [NOT] [MATERIALIZED] ( body ), … */
  function parseWith(scope: Scope, stop: number, queryEnd: number) {
    scope.clauses.push({ clause: "with", start: toks[pos].end });
    pos++;
    const recursive = kw(toks[pos]) === "recursive";
    if (recursive) pos++;
    while (pos < stop && relName(toks[pos])) {
      const nameTok = toks[pos++];
      const cols = pos < stop && toks[pos].text === "(" ? nameList(stop) : null;
      let body: Scope | null = null;
      let bodyEnd = nameTok.end;
      if (pos < stop && kw(toks[pos]) === "as") {
        pos++;
        if (kw(toks[pos]) === "not") pos++;
        if (kw(toks[pos]) === "materialized") pos++;
        if (pos < stop && toks[pos].text === "(") {
          const c = closeOf(pos, stop);
          const s = toks[pos].end;
          pos++;
          body = parseQuery(c, scope, false, s, c < stop ? toks[c].start : queryEnd);
          bodyEnd = c < stop ? toks[c].end : queryEnd;
          pos = c < stop ? c + 1 : stop;
        }
      }
      // SQL Server's CTEs are recursive without saying so.
      const selfVisible = recursive || family === "mssql";
      ctes.push({
        name: nameTok.value,
        range: range(nameTok),
        recursive,
        columns: cols,
        columnsComplete: cols !== null,
        body,
        visible: { start: selfVisible ? nameTok.start : bodyEnd, end: queryEnd },
      });
      if (pos < stop && toks[pos].text === ",") pos++;
      else break;
    }
  }

  /** A select item's top-level tokens; DISTINCT, TOP n, FIRST n, SKIP n…
      lead the first item only and are not part of it. */
  function itemTokens(idx: number[], first: boolean): SqlToken[] {
    const t = idx.map((i) => toks[i]);
    let i = 0;
    while (first && i < t.length) {
      const w = kw(t[i]);
      if (/^(top|first|skip)$/.test(w) && t[i + 1]?.kind === "number") i += 2;
      // DISTINCT ON (…): only the parens are tracked at this level.
      else if (w === "on" && t[i + 1]?.text === "(" && t[i + 2]?.text === ")") i += 3;
      else if (/^(distinct|all|unique|distinctrow|straight_join|high_priority|sql_\w+)$/.test(w)) i++;
      else break;
    }
    return t.slice(i);
  }

  /** True when the item so far ends an expression, so a name now aliases it. */
  function endsExpression(idx: number[], first: boolean): boolean {
    const t = itemTokens(idx, first);
    return t.length > 0 && exprEnd(t[t.length - 1]);
  }

  /** What a select item's output column is called, from its top-level tokens. */
  function describeItem(idx: number[], first: boolean): Item {
    const t = itemTokens(idx, first);
    const n = t.length;
    if (n === 0) return { anonymous: true };
    const last = t[n - 1];
    if (n >= 2 && kw(t[n - 2]) === "as" && isPart(last)) return { named: last.value };
    if (last.text === "*") return n >= 3 && t[n - 2].text === "." ? { star: t[n - 3].value } : n === 1 ? { star: null } : { anonymous: true };
    const chain = n % 2 === 1 && t.every((x, i) => (i % 2 === 0 ? (i === 0 ? colName(x) || x.kind === "quoted" : isPart(x)) : x.text === "."));
    if (chain) return { named: last.value };
    if (n >= 2 && aliasName(last) && exprEnd(t[n - 2])) return { named: last.value };
    return { anonymous: true };
  }

  // ---- Parse, then resolve: names are only all known once the whole
  // statement is read (the select list comes before its FROM).
  parseQuery(toks.length, null, false, stmtStart, stmtEnd);

  const cteAt = (name: string, at: number): Cte | undefined =>
    ctes
      .filter((c) => sameName(c.name, name) && c.visible.start <= at && at <= c.visible.end)
      .sort((a, b) => b.range.start - a.range.start)[0];

  // Relations that name a CTE are CTE relations.
  for (const p of pending) {
    const rel = p.ref.relation!;
    if (p.ref.role === "relation" && !p.target!.includes(".")) {
      const cte = cteAt(p.target!, p.ref.start);
      if (cte) {
        rel.kind = "cte";
        rel.cte = cte;
      }
    }
  }

  // Columns, memoized; a CTE reading itself gets "unknown" while computing.
  const busy = new Set<object>();
  const done = new Set<object>();
  const relColumns = (rel: Relation): Relation => {
    if (done.has(rel) || fixedColumns.has(rel) || busy.has(rel)) return rel;
    busy.add(rel);
    let cols: string[] | null = null;
    let complete = false;
    if (rel.kind === "table") {
      cols = tableColumns(schema, rel.target!);
      complete = cols !== null;
    } else if (rel.kind === "cte") {
      cteColumns(rel.cte!);
      cols = rel.cte!.columns;
      complete = rel.cte!.columnsComplete;
    } else if (rel.kind === "subquery") {
      scopeColumns(rel.body!);
      cols = rel.body!.columns;
      complete = rel.body!.columnsComplete;
    }
    rel.columns = cols;
    rel.columnsComplete = complete;
    busy.delete(rel);
    done.add(rel);
    return rel;
  };
  const cteColumns = (cte: Cte) => {
    if (done.has(cte) || busy.has(cte) || cte.columns || !cte.body) return;
    busy.add(cte);
    scopeColumns(cte.body);
    cte.columns = cte.body.columns;
    cte.columnsComplete = cte.body.columnsComplete;
    busy.delete(cte);
    done.add(cte);
  };
  const scopeColumns = (scope: Scope) => {
    const st = state.get(scope)!;
    if (done.has(scope) || busy.has(scope) || !st.hasSelect) return;
    busy.add(scope);
    const cols: string[] = [];
    let complete = true;
    for (const it of st.items) {
      if ("named" in it) cols.push(it.named);
      else if ("star" in it) {
        const rels = it.star === null ? scope.relations : [lookupRelation(scope, it.star)].filter((r): r is Relation => !!r);
        if (rels.length === 0) complete = false;
        for (const r of rels) {
          relColumns(r);
          if (r.columns) cols.push(...r.columns);
          if (!r.columnsComplete) complete = false;
        }
      } else complete = false;
    }
    scope.columns = cols.length || complete ? cols : null;
    scope.columnsComplete = complete;
    busy.delete(scope);
    done.add(scope);
  };
  for (const s of scopes) for (const r of s.relations) relColumns(r);
  for (const c of ctes) cteColumns(c);
  for (const s of scopes) scopeColumns(s);

  for (const p of pending) resolve(p);
  out.references = pending.map((p) => p.ref).sort((a, b) => a.start - b.start);
  return out;

  function resolve({ ref, qualifier, targetOnly, target }: PendingRef) {
    if (ref.role === "relation") {
      const rel = ref.relation!;
      if (rel.kind === "cte") {
        ref.resolution = "cte";
        ref.cte = rel.cte;
      } else ref.resolution = tableResolution(schema, target!);
      return;
    }
    if (ref.role === "qualifier") {
      const rel = lookupRelation(ref.scope, ref.name);
      if (rel) {
        ref.relation = rel;
        ref.resolution = rel.kind;
      } else ref.resolution = PSEUDO_QUALIFIERS.has(lc(ref.name)) ? "unresolved" : "unknown";
      return;
    }
    if (qualifier !== undefined) {
      const rel = lookupRelation(ref.scope, qualifier);
      if (rel) {
        ref.relation = rel;
        ref.resolution = hasColumn(rel, ref.name);
      }
      return;
    }
    if (targetOnly && ref.scope.relations[0]) {
      ref.relation = ref.scope.relations[0];
      ref.resolution = hasColumn(ref.relation, ref.name);
      return;
    }
    let sawAny = false;
    for (const level of levels(ref.scope)) {
      if (level.relations.length === 0) continue;
      sawAny = true;
      const found = level.relations.filter((r) => hasColumn(r, ref.name) === "column");
      const st = state.get(level)!;
      if (found.length === 1 || (found.length > 1 && (st.natural || st.using.has(lc(ref.name)) || ref.clause === "using"))) {
        ref.relation = found[0];
        ref.resolution = "column";
        return;
      }
      if (found.length > 1) {
        ref.resolution = "ambiguous";
        return;
      }
      // Not in a fully known level: it may still be in a relation we cannot see into.
      if (level.relations.some((r) => !r.columnsComplete)) return;
    }
    // ORDER BY / GROUP BY / HAVING may name a select-list alias.
    const items = state.get(ref.scope)!.items;
    if (["order-by", "group-by", "having"].includes(ref.clause) && items.some((i) => "named" in i && sameName(i.named, ref.name))) {
      ref.resolution = "column";
      return;
    }
    ref.resolution = sawAny ? "unknown" : "unresolved";
  }
}

function range(t: SqlToken): Range {
  return { start: t.start, end: t.end };
}

/** "column" when the relation has it, "unknown" when it surely does not. */
function hasColumn(rel: Relation, name: string): Resolution {
  if (rel.columns?.some((c) => sameName(c, name))) return "column";
  return rel.columns && rel.columnsComplete ? "unknown" : "unresolved";
}

/** Look a table up by its full name, then by its last part (schemas key tables
    by bare name). */
function findTable(names: string[], target: string): string | undefined {
  const bare = target.split(".").pop()!;
  return names.find((n) => sameName(n, target)) ?? names.find((n) => sameName(n, bare));
}

function tableColumns(schema: EditorSchema | null, target: string): string[] | null {
  if (!schema) return null;
  const key = findTable(Object.keys(schema.columns), target);
  return key ? schema.columns[key] : null;
}

function tableResolution(schema: EditorSchema | null, target: string): Resolution {
  if (!schema || schema.tables.length === 0) return "unresolved";
  if (findTable(schema.tables, target) || tableColumns(schema, target)) return "table";
  // Another schema's table may simply not be loaded.
  return target.includes(".") ? "unresolved" : "unknown";
}

/** The scopes whose relations `scope` sees, innermost first. A correlated
    scope sees its parent's; any other skips its parent's FROM but still sees
    what its parent sees from outside. */
function levels(scope: Scope): Scope[] {
  const out = [scope];
  for (let s = scope; s.parent; s = s.parent) if (s.correlated) out.push(s.parent);
  return out;
}

/** The relations visible from `scope`, innermost first. */
export function visibleRelations(scope: Scope): Relation[] {
  return levels(scope).flatMap((s) => s.relations);
}

/** The visible relation called `name` (alias, or bare table/CTE name). */
export function lookupRelation(scope: Scope, name: string): Relation | undefined {
  for (const s of levels(scope)) {
    const rel = s.relations.find((r) => r.name !== "" && sameName(r.name, name));
    if (rel) return rel;
  }
  return undefined;
}

/**
 * What is in scope at `offset` (a cursor): the innermost scope, the clause it
 * is in, the visible relations and their columns, and the nameable CTEs. Null
 * when the analysis has no statement there.
 */
export function scopeAt(analysis: SqlAnalysis, offset: number): CursorScope | null {
  const statement = analysis.statements.find((s) => s.start <= offset && offset <= s.end);
  if (!statement) return null;
  let scope = statement.scopes[0];
  for (const s of statement.scopes) if (s.start <= offset && offset <= s.end && s.start >= scope.start) scope = s;
  const clause = [...scope.clauses].reverse().find((c) => c.start <= offset)?.clause ?? "other";
  const relations = visibleRelations(scope);
  const columns = relations.flatMap((relation) => (relation.columns ?? []).map((name) => ({ name, relation })));
  const ctes = statement.ctes.filter((c) => c.visible.start <= offset && offset <= c.visible.end);
  return { statement, scope, clause, relations, columns, ctes };
}
