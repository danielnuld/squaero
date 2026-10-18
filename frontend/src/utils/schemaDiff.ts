// Pure schema diff + reviewable migration script (#34, extended by #672). Given
// two schema snapshots (read by utils/schemaCatalog.ts), it computes what differs
// — tables, columns, primary keys, unique/check/foreign-key constraints, indexes
// and views — and generates the SQL that would make the TARGET match the SOURCE,
// in the target engine's dialect and in dependency order. Nothing here runs SQL:
// the wizard shows the script, and applying it is a separate, explicit step.
//
// Honesty rules (.rules/general.md): what the target engine cannot do (SQLite
// altering a column or a constraint in place, SQL Server defaults, MongoDB at
// all) is emitted as a `-- UNSUPPORTED:` comment AND returned as an issue for
// the UI; what could not be read on either side is reported as "not compared",
// never diffed as if it were empty.

import type { ResultSet } from "./query";
import { quoteIdentifier, qualifiedName } from "./schema";
import { engineFamily } from "./engineFamily";
import { en } from "./messages/en";

// ─── Model ───────────────────────────────────────────────────────────────────

/** A column as reported by schema.describe. `dflt` is the raw SQL default. */
export interface ColumnDef {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
  dflt?: string | null;
}

/** A primary key or unique constraint: an ordered column list, optionally named. */
export interface KeyDef {
  name?: string;
  columns: string[];
}

/** A plain (non-constraint) index. */
export interface IndexDef {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeyDef {
  name?: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
}

/** A CHECK constraint; `expr` is the boolean expression as the catalog gave it. */
export interface CheckDef {
  name?: string;
  expr: string;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  primaryKey: KeyDef | null;
  uniques: KeyDef[];
  indexes: IndexDef[];
  foreignKeys: ForeignKeyDef[];
  checks: CheckDef[];
}

/** A view and its full CREATE statement (schema.ddl). */
export interface ViewDef {
  name: string;
  ddl: string;
}

/** Metadata that is read separately and can be unavailable on one side. */
export type Category = "constraints" | "checks" | "indexes" | "views" | "defaults";

/** One side of the comparison, as read from a connection. */
export interface SchemaSnapshot {
  engine: string;
  tables: TableDef[];
  views: ViewDef[];
  /** Categories that could not be read: the engine error, or "" when the engine
      has no catalog for it. A missing category is not compared. */
  missing: Partial<Record<Category, string>>;
  /** Indexes left out of the comparison (expressions, partial, non-B-tree…),
      as "table.index". */
  skipped: string[];
}

/** Parse a schema.describe result into column definitions. */
export function parseStructure(describe: ResultSet): ColumnDef[] {
  const idx = (name: string) => describe.columns.findIndex((c) => c.name === name);
  const nameI = idx("name");
  const typeI = idx("type");
  const nnI = idx("notnull");
  const pkI = idx("pk");
  const dfI = idx("dflt_value");
  if (nameI === -1) {
    return [];
  }
  const truthy = (v: string | null | undefined) =>
    v != null && v !== "" && v !== "0";
  return describe.rows
    .filter((r) => r[nameI] != null)
    .map((r) => ({
      name: r[nameI] as string,
      type: (typeI !== -1 ? r[typeI] : null) ?? "",
      notnull: nnI !== -1 ? truthy(r[nnI]) : false,
      pk: pkI !== -1 ? truthy(r[pkI]) : false,
      dflt: dfI !== -1 ? r[dfI] ?? null : null,
    }));
}

// ─── Diff ────────────────────────────────────────────────────────────────────

export interface ColumnChange {
  name: string;
  from: ColumnDef; // target's current definition
  to: ColumnDef; // source's definition
  type: boolean;
  nullability: boolean;
  dflt: boolean;
}

/** Added/removed items of one kind; a changed item shows up as removed + added. */
export interface AddRemove<T> {
  added: T[];
  removed: T[];
}

/** What must change in one table that exists on both sides. */
export interface TableChange {
  name: string; // the target's spelling
  added: ColumnDef[];
  removed: ColumnDef[];
  changed: ColumnChange[];
  /** Set when the primary key differs (either side may be null). */
  pk: { from: KeyDef | null; to: KeyDef | null } | null;
  uniques: AddRemove<KeyDef>;
  indexes: AddRemove<IndexDef>;
  foreignKeys: AddRemove<ForeignKeyDef>;
  checks: AddRemove<CheckDef>;
}

/** A category one side could not provide. */
export interface NotCompared {
  side: "source" | "target";
  engine: string;
  category: Category;
  reason: string;
}

export interface SchemaDiff {
  sourceEngine: string;
  targetEngine: string;
  addedTables: TableDef[];
  removedTables: TableDef[];
  changedTables: TableChange[];
  addedViews: ViewDef[];
  removedViews: ViewDef[];
  changedViews: { source: ViewDef; target: ViewDef }[];
  notCompared: NotCompared[];
  skipped: string[];
}

// Names match case-insensitively: PostgreSQL and Informix fold to lower case,
// SQL Server and MySQL keep what was typed, and "Users" vs "users" across two
// engines is the same table, not a drop + create.
const k = (s: string) => s.toLowerCase();
const colsKey = (cols: string[]) => cols.map(k).join(",");

/** Type text normalized for comparison (case, spacing around parens/commas). */
const normType = (t: string) =>
  t.toLowerCase().replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim();

/** A default normalized for comparison: SQL Server wraps it in parens, ((0)). */
function normDefault(d: string | null | undefined): string {
  let s = (d ?? "").trim();
  while (/^\(.*\)$/.test(s) && balanced(s.slice(1, -1))) s = s.slice(1, -1).trim();
  return s;
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

/** A CHECK expression normalized for comparison: engines re-print them with
    their own parens, quoting and spacing ((qty > 0)) / ([qty]>(0)) / (`qty` > 0).
    ponytail: strips every paren and quote, so two checks differing only in
    grouping compare equal; parse the expression if that ever matters. */
const normExpr = (e: string) => e.toLowerCase().replace(/[\s()"`[\]]/g, "");

/** Split two lists by a signature: in source only, in target only, in both. */
function match<T>(
  source: T[],
  target: T[],
  sig: (x: T) => string,
): { added: T[]; removed: T[]; kept: [T, T][] } {
  const tgt = new Map(target.map((x) => [sig(x), x]));
  const src = new Set(source.map(sig));
  const kept: [T, T][] = [];
  for (const s of source) {
    const t = tgt.get(sig(s));
    if (t) kept.push([s, t]);
  }
  return {
    added: source.filter((x) => !tgt.has(sig(x))),
    removed: target.filter((x) => !src.has(sig(x))),
    kept,
  };
}

const fkSig = (f: ForeignKeyDef) =>
  `${colsKey(f.columns)}>${k(f.refTable)}(${colsKey(f.refColumns)})`;
const indexSig = (i: IndexDef) => `${i.unique ? "u" : ""}:${colsKey(i.columns)}`;
const pkSig = (p: KeyDef | null) => (p ? [...p.columns].map(k).sort().join(",") : "");

/**
 * Diff two snapshots: what must change in TARGET to match SOURCE. Constraints,
 * indexes and checks are matched by what they do (columns, referenced table,
 * expression), not by name — names are engine-generated more often than not
 * (SQLite has none, MySQL calls every PK PRIMARY). Renames are never guessed: a
 * renamed column is a drop + add (generateMigration adds a note).
 */
export function diffSchemas(source: SchemaSnapshot, target: SchemaSnapshot): SchemaDiff {
  const notCompared: NotCompared[] = [];
  const has = (c: Category) => !(c in source.missing) && !(c in target.missing);
  for (const [side, snap] of [["source", source], ["target", target]] as const) {
    for (const [category, reason] of Object.entries(snap.missing)) {
      notCompared.push({ side, engine: snap.engine, category: category as Category, reason: reason ?? "" });
    }
  }

  const tables = match(source.tables, target.tables, (t) => k(t.name));
  const changes = tables.kept.map(([s, t]) => diffTable(s, t, has));

  // A foreign key over a column whose type changes, or pointing at a primary
  // key that is replaced, has to be dropped and re-added: PostgreSQL, SQL
  // Server and MySQL refuse to alter a column a key points at (or from), or to
  // drop a key another one references. Such kept keys are re-created.
  const retyped = new Set<string>();
  const rekeyed = new Set(changes.filter((ch) => ch.pk).map((ch) => k(ch.name)));
  for (const ch of changes) {
    for (const c of ch.changed) if (c.type) retyped.add(`${k(ch.name)}.${k(c.name)}`);
  }
  if (retyped.size + rekeyed.size > 0 && has("constraints")) {
    tables.kept.forEach(([s, t], i) => {
      const fks = match(s.foreignKeys, t.foreignKeys, fkSig);
      for (const [sf, tf] of fks.kept) {
        const touched =
          rekeyed.has(k(tf.refTable)) ||
          tf.columns.some((c) => retyped.has(`${k(t.name)}.${k(c)}`)) ||
          tf.refColumns.some((c) => retyped.has(`${k(tf.refTable)}.${k(c)}`));
        if (touched) {
          changes[i].foreignKeys.removed.push(tf);
          changes[i].foreignKeys.added.push(sf);
        }
      }
    });
  }

  let addedViews: ViewDef[] = [];
  let removedViews: ViewDef[] = [];
  const changedViews: { source: ViewDef; target: ViewDef }[] = [];
  if (has("views")) {
    const views = match(source.views, target.views, (v) => k(v.name));
    addedViews = views.added;
    removedViews = views.removed;
    for (const [s, t] of views.kept) {
      if (viewBody(s.ddl) !== viewBody(t.ddl)) changedViews.push({ source: s, target: t });
    }
    // An unchanged view still has to be dropped and re-created when it reads a
    // view that is, or a table losing or retyping a column: PostgreSQL refuses
    // to drop or alter what a view depends on. Transitively.
    const touched = new Set(
      changes.filter((c) => c.removed.length > 0 || c.changed.some((x) => x.type)).map((c) => k(c.name)),
    );
    const dropped = new Set([...removedViews, ...changedViews.map((v) => v.target)].map((v) => k(v.name)));
    const reads = viewDeps(target.views, [...touched]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [s, t] of views.kept) {
        if (!dropped.has(k(t.name)) && reads(t.name).some((d) => dropped.has(k(d)) || touched.has(k(d)))) {
          changedViews.push({ source: s, target: t });
          dropped.add(k(t.name));
          grew = true;
        }
      }
    }
  }

  return {
    sourceEngine: source.engine,
    targetEngine: target.engine,
    addedTables: tables.added,
    removedTables: tables.removed,
    changedTables: changes.filter((c) => !tableChangeEmpty(c)),
    addedViews,
    removedViews,
    changedViews,
    notCompared,
    skipped: [...source.skipped, ...target.skipped],
  };
}

function diffTable(s: TableDef, t: TableDef, has: (c: Category) => boolean): TableChange {
  const cols = match(s.columns, t.columns, (c) => k(c.name));
  const changed: ColumnChange[] = [];
  for (const [sc, tc] of cols.kept) {
    const type = normType(sc.type) !== normType(tc.type);
    const nullability = sc.notnull !== tc.notnull;
    const dflt = has("defaults") && normDefault(sc.dflt) !== normDefault(tc.dflt);
    if (type || nullability || dflt) {
      changed.push({ name: tc.name, from: tc, to: sc, type, nullability, dflt });
    }
  }
  const pick = <T>(on: boolean, a: T[], b: T[], sig: (x: T) => string): AddRemove<T> => {
    if (!on) return { added: [], removed: [] };
    const m = match(a, b, sig);
    return { added: m.added, removed: m.removed };
  };
  const constraints = has("constraints");
  return {
    name: t.name,
    added: cols.added,
    removed: cols.removed,
    changed,
    pk: pkSig(s.primaryKey) !== pkSig(t.primaryKey) ? { from: t.primaryKey, to: s.primaryKey } : null,
    uniques: pick(constraints, s.uniques, t.uniques, (u) => colsKey(u.columns)),
    indexes: pick(has("indexes"), s.indexes, t.indexes, indexSig),
    foreignKeys: pick(constraints, s.foreignKeys, t.foreignKeys, fkSig),
    checks: pick(has("checks"), s.checks, t.checks, (c) => normExpr(c.expr)),
  };
}

/** True when a table change carries nothing to do. */
export function tableChangeEmpty(c: TableChange): boolean {
  return (
    c.added.length + c.removed.length + c.changed.length === 0 &&
    c.pk === null &&
    [c.uniques, c.indexes, c.foreignKeys, c.checks].every(
      (x) => x.added.length + x.removed.length === 0,
    )
  );
}

/** True when the two schemas match in everything that was compared. */
export function diffEmpty(d: SchemaDiff): boolean {
  return (
    d.addedTables.length + d.removedTables.length + d.changedTables.length === 0 &&
    d.addedViews.length + d.removedViews.length + d.changedViews.length === 0
  );
}

/** The query of a CREATE VIEW, normalized for comparison: case, spacing and
    identifier quotes dropped, and whatever sits between CREATE and AS (MySQL's
    ALGORITHM/DEFINER clauses, the name's quoting) ignored. */
export function viewBody(ddl: string): string {
  const m = /\bview\b[\s\S]*?\bas\b([\s\S]*)$/i.exec(ddl);
  return (m ? m[1] : ddl)
    .replace(/;\s*$/, "")
    .toLowerCase()
    .replace(/[\s"`[\]]/g, "");
}

// ─── Dependency ordering ─────────────────────────────────────────────────────

/**
 * Order names so each comes after what it depends on (Kahn's algorithm, ties
 * kept in input order). Dependencies outside the list and self-references are
 * ignored. Names caught in a cycle — or depending on one — cannot be ordered:
 * they are appended in input order and also returned in `cyclic`, so the caller
 * can break the cycle (foreign keys are added after every table exists).
 */
export function orderByDependencies(
  names: string[],
  deps: (name: string) => string[],
): { order: string[]; cyclic: string[] } {
  const inSet = new Set(names.map(k));
  const pending = new Map<string, Set<string>>();
  for (const n of names) {
    pending.set(k(n), new Set(deps(n).map(k).filter((d) => d !== k(n) && inSet.has(d))));
  }
  const order: string[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const n of names) {
      const ds = pending.get(k(n));
      if (ds && [...ds].every((d) => !pending.has(d))) {
        order.push(n);
        pending.delete(k(n));
        progress = true;
      }
    }
  }
  const cyclic = names.filter((n) => pending.has(k(n)));
  return { order: [...order, ...cyclic], cyclic };
}

/** The other views of `views` (and the `extra` names) that a view's query
    mentions as a whole word. ponytail: a textual match, so a name inside a
    string literal or comment counts too — it only costs an extra re-create. */
function viewDeps(views: ViewDef[], extra: string[] = []): (name: string) => string[] {
  // The raw query (not viewBody, which strips the spaces word matching needs).
  const query = (ddl: string) => k(/\bview\b[\s\S]*?\bas\b([\s\S]*)$/i.exec(ddl)?.[1] ?? ddl);
  const body = new Map(views.map((v) => [k(v.name), query(v.ddl)]));
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = [...views.map((v) => v.name), ...extra];
  return (name) =>
    names
      .filter((n) => k(n) !== k(name))
      .filter((n) => new RegExp(`(^|[^\\w$])${esc(k(n))}($|[^\\w$])`).test(body.get(k(name)) ?? ""));
}

// ─── Migration script ────────────────────────────────────────────────────────

export type IssueCode =
  | "mongodb"
  | "sqliteAlterColumn"
  | "sqliteConstraint"
  | "sqliteNotNullColumn"
  | "mssqlDefault"
  | "noConstraintName"
  | "dropTableSkipped"
  | "possibleRename"
  | "notCompared"
  | "skippedIndex"
  | "informixModify"
  | "crossEngine"
  | "fkCycle";

/** Something the script could not do (`unsupported`) or the reader should know. */
export interface ScriptIssue {
  kind: "unsupported" | "note";
  code: IssueCode;
  /** The object concerned ("orders.total"), or the category for notCompared. */
  object: string;
  detail?: string;
  /** notCompared only: which side lacked the metadata. */
  side?: "source" | "target";
}

/** English text of an issue, for the comment in the script (the UI shows the
    same catalog entry in the user's language). */
const issueText = (code: IssueCode) => en[`ssync.issue.${code}`] ?? code;

export interface MigrationOptions {
  /** Where the target objects live: `db` qualifies on MySQL/Informix, `schema`
      on PostgreSQL/SQL Server. */
  container?: { db?: string; schema?: string };
  /** Generate DROP TABLE for tables only in the target (off by default: a
      dropped table takes its data with it). */
  dropTables?: boolean;
}

export interface MigrationScript {
  /** Statements in execution order, each ending in `;`, interleaved with the
      `--` comments that explain or flag them. */
  statements: string[];
  issues: ScriptIssue[];
}

/** Whether a generated line is an executable statement (not a comment). */
export function isExecutable(statement: string): boolean {
  return !statement.trimStart().startsWith("--");
}

/** The script as one text, ready for the editor or a .sql file. */
export function scriptText(script: MigrationScript): string {
  return script.statements.join("\n") + (script.statements.length ? "\n" : "");
}

/**
 * Generate the migration script for a diff, in the TARGET engine's dialect and
 * in dependency order:
 *
 *   1. drop changed/removed views, dependents first (they read the tables);
 *   2. drop removed foreign keys (before the keys, columns and tables they use);
 *   3. drop removed checks, unique constraints, indexes and changed primary keys;
 *   4. drop target-only tables (only with `dropTables`), dependents first;
 *   5. create source-only tables, referenced tables first;
 *   6. add, alter and drop columns;
 *   7. add primary keys, unique and check constraints, create indexes;
 *   8. add foreign keys — after every table and column exists, which is what
 *      breaks FK cycles (SQLite, which cannot ALTER one in, declares them inline);
 *   9. create added/changed views, the views they read first.
 */
export function generateMigration(diff: SchemaDiff, opts: MigrationOptions = {}): MigrationScript {
  const e = diff.targetEngine;
  const f = engineFamily(e);
  const out: string[] = [];
  const issues: ScriptIssue[] = [];
  const issue = (i: ScriptIssue) => {
    issues.push(i);
    const tag = i.kind === "unsupported" ? "UNSUPPORTED" : "NOTE";
    out.push(`-- ${tag}: ${i.object}: ${issueText(i.code)}${i.detail ? ` (${i.detail})` : ""}`);
  };
  const unsupported = (code: IssueCode, object: string, detail?: string) =>
    issue({ kind: "unsupported", code, object, detail });
  const note = (code: IssueCode, object: string, detail?: string) =>
    issue({ kind: "note", code, object, detail });

  for (const side of [diff.sourceEngine, e]) {
    if (engineFamily(side) === "mongodb") {
      unsupported("mongodb", side);
      return { statements: out, issues };
    }
  }

  const c = opts.container ?? {};
  const qt = (name: string) =>
    qualifiedName(
      {
        db: f === "mysql" || f === "informix" ? c.db : undefined,
        schema: f === "postgres" || f === "mssql" ? c.schema : undefined,
        name,
      },
      e,
    );
  const q = (id: string) => quoteIdentifier(id, e);
  const qcols = (cols: string[]) => cols.map(q).join(", ");
  const sqlite = f === "sqlite";

  // Header: what was not compared and what the reader must review.
  for (const nc of diff.notCompared) {
    issues.push({ kind: "note", code: "notCompared", object: nc.category, detail: nc.reason, side: nc.side });
    out.push(
      `-- NOTE: ${nc.category} not compared (${nc.side}, ${nc.engine}: ${nc.reason || "no catalog for this engine"})`,
    );
  }
  for (const s of diff.skipped) note("skippedIndex", s);
  if (engineFamily(diff.sourceEngine) !== f) note("crossEngine", `${diff.sourceEngine} -> ${e}`);

  // Constraint clauses. Informix names a constraint AFTER its definition.
  const named = (body: string, name?: string) => {
    if (!name) return body;
    return f === "informix" ? `${body} CONSTRAINT ${q(name)}` : `CONSTRAINT ${q(name)} ${body}`;
  };
  const pkBody = (p: KeyDef) => `PRIMARY KEY (${qcols(p.columns)})`;
  const uniqueBody = (u: KeyDef) => `UNIQUE (${qcols(u.columns)})`;
  const checkBody = (ch: CheckDef) => `CHECK (${ch.expr})`;
  const fkBody = (fk: ForeignKeyDef) =>
    `FOREIGN KEY (${qcols(fk.columns)}) REFERENCES ${qt(fk.refTable)} (${qcols(fk.refColumns)})`;
  const addConstraint = (table: string, body: string, name?: string) =>
    f === "informix"
      ? `ALTER TABLE ${qt(table)} ADD CONSTRAINT ${named(body, name)};`
      : `ALTER TABLE ${qt(table)} ADD ${named(body, name)};`;

  /** Emit the DROP of a constraint, or an issue when it cannot be generated. */
  const dropConstraint = (table: string, kind: "P" | "U" | "F" | "C", name: string | undefined, label: string) => {
    if (sqlite) {
      unsupported("sqliteConstraint", table, `DROP ${label}`);
      return;
    }
    if (f === "mysql") {
      if (kind === "P") return void out.push(`ALTER TABLE ${qt(table)} DROP PRIMARY KEY;`);
      if (!name) return unsupported("noConstraintName", table, label);
      const what = { U: "INDEX", F: "FOREIGN KEY", C: "CHECK" }[kind];
      return void out.push(`ALTER TABLE ${qt(table)} DROP ${what} ${q(name)};`);
    }
    if (!name) return unsupported("noConstraintName", table, label);
    out.push(`ALTER TABLE ${qt(table)} DROP CONSTRAINT ${q(name)};`);
  };

  const columnClause = (col: ColumnDef) => {
    // DEFAULT before NOT NULL: the one order every engine accepts (Informix
    // requires it).
    let s = `${q(col.name)} ${col.type || "TEXT"}`;
    if (col.dflt != null && col.dflt !== "") s += ` DEFAULT ${col.dflt}`;
    if (col.notnull) s += " NOT NULL";
    return s;
  };

  const createIndex = (table: string, ix: IndexDef) =>
    out.push(`CREATE ${ix.unique ? "UNIQUE " : ""}INDEX ${q(ix.name)} ON ${qt(table)} (${qcols(ix.columns)});`);
  const dropIndex = (table: string, ix: IndexDef) =>
    out.push(
      f === "mysql" || f === "mssql"
        ? `DROP INDEX ${q(ix.name)} ON ${qt(table)};`
        : `DROP INDEX ${qt(ix.name)};`,
    );

  const changed = diff.changedTables;
  const created = orderByDependencies(
    diff.addedTables.map((t) => t.name),
    (n) => diff.addedTables.find((t) => k(t.name) === k(n))!.foreignKeys.map((fk) => fk.refTable),
  );
  const createdTables = created.order.map((n) => diff.addedTables.find((t) => t.name === n)!);

  // 1. Views that change or go away are dropped first; dependents before what
  //    they read.
  const dropViews = [...diff.removedViews, ...diff.changedViews.map((v) => v.target)];
  for (const n of orderByDependencies(dropViews.map((v) => v.name), viewDeps(dropViews)).order.reverse()) {
    out.push(`DROP VIEW ${qt(n)};`);
  }

  // 2. Foreign keys that go away (including those of tables being dropped, so
  //    the drop order cannot trip over them).
  for (const ch of changed) {
    for (const fk of ch.foreignKeys.removed) dropConstraint(ch.name, "F", fk.name, fkBody(fk));
  }
  if (opts.dropTables && !sqlite) {
    for (const t of diff.removedTables) {
      for (const fk of t.foreignKeys) dropConstraint(t.name, "F", fk.name, fkBody(fk));
    }
  }

  // 3. Checks, unique constraints, indexes and primary keys that go away.
  for (const ch of changed) {
    for (const x of ch.checks.removed) dropConstraint(ch.name, "C", x.name, checkBody(x));
    for (const u of ch.uniques.removed) dropConstraint(ch.name, "U", u.name, uniqueBody(u));
    for (const ix of ch.indexes.removed) dropIndex(ch.name, ix);
    if (ch.pk?.from) dropConstraint(ch.name, "P", ch.pk.from.name, pkBody(ch.pk.from));
  }

  // 4. Tables only in the target.
  if (opts.dropTables) {
    const dropped = orderByDependencies(
      diff.removedTables.map((t) => t.name),
      (n) => diff.removedTables.find((t) => k(t.name) === k(n))!.foreignKeys.map((fk) => fk.refTable),
    );
    for (const n of dropped.order.reverse()) out.push(`DROP TABLE ${qt(n)};`);
  } else {
    for (const t of diff.removedTables) note("dropTableSkipped", t.name);
  }

  // 5. New tables, referenced ones first. Foreign keys are inline only on
  //    SQLite (which accepts a forward reference); elsewhere they are added in
  //    step 8, so cycles need no special handling beyond saying so.
  if (created.cyclic.length > 0 && !sqlite) note("fkCycle", created.cyclic.join(", "));
  for (const t of createdTables) {
    const defs = t.columns.map((col) => `  ${columnClause(col)}`);
    if (t.primaryKey) defs.push(`  ${named(pkBody(t.primaryKey), t.primaryKey.name)}`);
    for (const u of t.uniques) defs.push(`  ${named(uniqueBody(u), u.name)}`);
    for (const x of t.checks) defs.push(`  ${named(checkBody(x), x.name)}`);
    if (sqlite) for (const fk of t.foreignKeys) defs.push(`  ${named(fkBody(fk), fk.name)}`);
    out.push(`CREATE TABLE ${qt(t.name)} (\n${defs.join(",\n")}\n);`);
  }

  // 6. Columns: add, alter, drop.
  let informixModified = false;
  const alterColumn = (table: string, cc: ColumnChange): void => {
    const what = [
      cc.type ? `${cc.from.type} -> ${cc.to.type}` : "",
      cc.nullability ? (cc.to.notnull ? "NOT NULL" : "NULL") : "",
      cc.dflt ? `DEFAULT ${cc.to.dflt ?? "none"}` : "",
    ].filter(Boolean).join(", ");
    const col = q(cc.name);
    const t = qt(table);
    if (sqlite) return unsupported("sqliteAlterColumn", `${table}.${cc.name}`, what);
    if (f === "mysql") return void out.push(`ALTER TABLE ${t} MODIFY COLUMN ${columnClause(cc.to)};`);
    if (f === "informix") {
      if (!informixModified) note("informixModify", table);
      informixModified = true;
      return void out.push(`ALTER TABLE ${t} MODIFY (${columnClause(cc.to)});`);
    }
    if (f === "mssql") {
      if (cc.type || cc.nullability) {
        out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} ${cc.to.type} ${cc.to.notnull ? "NOT NULL" : "NULL"};`);
      }
      if (cc.dflt) unsupported("mssqlDefault", `${table}.${cc.name}`, `DEFAULT ${cc.to.dflt ?? "none"}`);
      return;
    }
    // PostgreSQL and the ANSI default: one ALTER COLUMN per attribute.
    if (cc.type) out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} TYPE ${cc.to.type};`);
    if (cc.nullability) {
      out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} ${cc.to.notnull ? "SET" : "DROP"} NOT NULL;`);
    }
    if (cc.dflt) {
      out.push(
        cc.to.dflt
          ? `ALTER TABLE ${t} ALTER COLUMN ${col} SET DEFAULT ${cc.to.dflt};`
          : `ALTER TABLE ${t} ALTER COLUMN ${col} DROP DEFAULT;`,
      );
    }
  };

  for (const ch of changed) {
    const t = qt(ch.name);
    for (const col of ch.added) {
      if (sqlite && col.notnull && !col.dflt) {
        unsupported("sqliteNotNullColumn", `${ch.name}.${col.name}`);
        continue;
      }
      const add = f === "mssql" || f === "informix" ? "ADD" : "ADD COLUMN";
      out.push(`ALTER TABLE ${t} ${add} ${columnClause(col)};`);
    }
    for (const cc of ch.changed) alterColumn(ch.name, cc);
    for (const col of ch.removed) {
      out.push(`ALTER TABLE ${t} ${f === "informix" ? "DROP" : "DROP COLUMN"} ${q(col.name)};`);
    }
    for (const r of ch.removed) {
      const a = ch.added.find((x) => normType(x.type) === normType(r.type));
      if (a) note("possibleRename", ch.name, `${r.name} -> ${a.name}`);
    }
  }

  // 7. Primary keys, unique and check constraints, indexes.
  const addOrFlag = (table: string, body: string, name?: string) =>
    sqlite ? unsupported("sqliteConstraint", table, `ADD ${body}`) : void out.push(addConstraint(table, body, name));
  for (const ch of changed) {
    // On SQLite a changed key was already flagged once, at its drop.
    if (ch.pk?.to && !(sqlite && ch.pk.from)) addOrFlag(ch.name, pkBody(ch.pk.to), ch.pk.to.name);
    for (const u of ch.uniques.added) addOrFlag(ch.name, uniqueBody(u), u.name);
    for (const x of ch.checks.added) addOrFlag(ch.name, checkBody(x), x.name);
    for (const ix of ch.indexes.added) createIndex(ch.name, ix);
  }
  for (const t of createdTables) for (const ix of t.indexes) createIndex(t.name, ix);

  // 8. Foreign keys, once every table and column they join exists.
  if (!sqlite) {
    for (const t of createdTables) for (const fk of t.foreignKeys) out.push(addConstraint(t.name, fkBody(fk), fk.name));
  }
  for (const ch of changed) for (const fk of ch.foreignKeys.added) addOrFlag(ch.name, fkBody(fk), fk.name);

  // 9. Views, the ones they read first.
  const newViews = [...diff.addedViews, ...diff.changedViews.map((v) => v.source)];
  const deps = viewDeps(newViews);
  for (const n of orderByDependencies(newViews.map((v) => v.name), deps).order) {
    const v = newViews.find((x) => x.name === n)!;
    out.push(`${v.ddl.trim().replace(/;\s*$/, "")};`);
  }

  return { statements: out, issues };
}

// ─── Summary for the UI ──────────────────────────────────────────────────────

export type DiffKind =
  | "table"
  | "column"
  | "primaryKey"
  | "unique"
  | "index"
  | "foreignKey"
  | "check"
  | "view";

/** One line of the categorized difference list. */
export interface DiffItem {
  kind: DiffKind;
  change: "added" | "removed" | "changed";
  name: string;
  detail?: string;
}

/** Flatten a diff into categorized lines for display. */
export function diffItems(d: SchemaDiff): DiffItem[] {
  const items: DiffItem[] = [];
  const push = (kind: DiffKind, change: DiffItem["change"], name: string, detail?: string) =>
    items.push(detail ? { kind, change, name, detail } : { kind, change, name });
  const list = (cols: string[]) => `(${cols.join(", ")})`;

  for (const t of d.addedTables) push("table", "added", t.name);
  for (const t of d.removedTables) push("table", "removed", t.name);
  for (const ch of d.changedTables) {
    const n = ch.name;
    for (const c of ch.added) push("column", "added", `${n}.${c.name}`, c.type);
    for (const c of ch.removed) push("column", "removed", `${n}.${c.name}`, c.type);
    for (const c of ch.changed) {
      const what = [
        c.type ? `${c.from.type} -> ${c.to.type}` : "",
        c.nullability ? (c.to.notnull ? "NULL -> NOT NULL" : "NOT NULL -> NULL") : "",
        c.dflt ? `DEFAULT ${c.from.dflt ?? "-"} -> ${c.to.dflt ?? "-"}` : "",
      ].filter(Boolean).join(", ");
      push("column", "changed", `${n}.${c.name}`, what);
    }
    if (ch.pk) {
      push(
        "primaryKey",
        ch.pk.from && ch.pk.to ? "changed" : ch.pk.to ? "added" : "removed",
        n,
        `${ch.pk.from ? list(ch.pk.from.columns) : "-"} -> ${ch.pk.to ? list(ch.pk.to.columns) : "-"}`,
      );
    }
    const label = (name: string | undefined, cols: string) => (name ? `${n}.${name}` : n) + ` ${cols}`;
    for (const u of ch.uniques.added) push("unique", "added", label(u.name, list(u.columns)));
    for (const u of ch.uniques.removed) push("unique", "removed", label(u.name, list(u.columns)));
    for (const i of ch.indexes.added) push("index", "added", label(i.name, list(i.columns)));
    for (const i of ch.indexes.removed) push("index", "removed", label(i.name, list(i.columns)));
    const fk = (x: ForeignKeyDef) => `${list(x.columns)} -> ${x.refTable}${list(x.refColumns)}`;
    for (const x of ch.foreignKeys.added) push("foreignKey", "added", label(x.name, fk(x)));
    for (const x of ch.foreignKeys.removed) push("foreignKey", "removed", label(x.name, fk(x)));
    for (const x of ch.checks.added) push("check", "added", label(x.name, x.expr));
    for (const x of ch.checks.removed) push("check", "removed", label(x.name, x.expr));
  }
  for (const v of d.addedViews) push("view", "added", v.name);
  for (const v of d.removedViews) push("view", "removed", v.name);
  for (const v of d.changedViews) push("view", "changed", v.source.name);
  return items;
}
