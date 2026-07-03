// Pure structure diff + migration-SQL generation (#34). Given two schemas read
// through schema.tree (table lists) and schema.describe (columns), it computes
// what tables/columns differ and emits the SQL that would make the TARGET match
// the SOURCE. All pure and unit-tested; the compare UI does the fetching and
// shows the generated SQL for confirmation before anything runs.
//
// Scope (M9 decision): tables and columns only. Indexes/keys beyond the primary
// key are not compared — schema.describe does not expose them yet.

import type { ResultSet } from "./query";
import { quoteIdentifier } from "./schema";

/** A column as reported by schema.describe. */
export interface ColumnDef {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
}

/** Parse a schema.describe result into column definitions. */
export function parseStructure(describe: ResultSet): ColumnDef[] {
  const idx = (name: string) => describe.columns.findIndex((c) => c.name === name);
  const nameI = idx("name");
  const typeI = idx("type");
  const nnI = idx("notnull");
  const pkI = idx("pk");
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
    }));
}

/** A column that differs in type between target and source. */
export interface ColumnChange {
  name: string;
  from: string; // target's current type
  to: string; // source's type
}

/** Column-level differences of TARGET relative to SOURCE. */
export interface ColumnDiff {
  added: ColumnDef[]; // in source, missing from target -> ADD
  removed: ColumnDef[]; // in target, absent from source -> DROP
  changed: ColumnChange[]; // same name, different type
}

/** Diff a table's columns: what must change in TARGET to match SOURCE. */
export function diffColumns(source: ColumnDef[], target: ColumnDef[]): ColumnDiff {
  const byName = (cols: ColumnDef[]) =>
    new Map(cols.map((c) => [c.name, c]));
  const src = byName(source);
  const tgt = byName(target);

  const added = source.filter((c) => !tgt.has(c.name));
  const removed = target.filter((c) => !src.has(c.name));
  const changed: ColumnChange[] = [];
  for (const c of source) {
    const t = tgt.get(c.name);
    if (t && t.type !== c.type) {
      changed.push({ name: c.name, from: t.type, to: c.type });
    }
  }
  return { added, removed, changed };
}

/** True when a column diff has no additions, removals or type changes. */
export function columnDiffEmpty(d: ColumnDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

/** Table-list differences of TARGET relative to SOURCE. */
export interface TableDiff {
  onlyInSource: string[]; // to CREATE in target
  onlyInTarget: string[]; // to DROP from target
  common: string[]; // to compare column by column
}

/** Diff two table-name lists. */
export function diffTableLists(source: string[], target: string[]): TableDiff {
  const t = new Set(target);
  const s = new Set(source);
  return {
    onlyInSource: source.filter((x) => !t.has(x)),
    onlyInTarget: target.filter((x) => !s.has(x)),
    common: source.filter((x) => t.has(x)),
  };
}

/** A CREATE TABLE for the given columns (ANSI quoting; NOT NULL + PRIMARY KEY). */
export function generateCreateTable(table: string, columns: ColumnDef[]): string {
  const defs = columns.map((c) => {
    let d = `  ${quoteIdentifier(c.name)} ${c.type || "TEXT"}`;
    if (c.notnull) d += " NOT NULL";
    return d;
  });
  const pk = columns.filter((c) => c.pk).map((c) => quoteIdentifier(c.name));
  if (pk.length > 0) {
    defs.push(`  PRIMARY KEY (${pk.join(", ")})`);
  }
  return `CREATE TABLE ${quoteIdentifier(table)} (\n${defs.join(",\n")}\n);`;
}

/** The ALTER statements (and type-change notes) to bring one table into line. */
export function generateColumnMigration(table: string, diff: ColumnDiff): string[] {
  const t = quoteIdentifier(table);
  const out: string[] = [];
  for (const c of diff.added) {
    out.push(
      `ALTER TABLE ${t} ADD COLUMN ${quoteIdentifier(c.name)} ${c.type || "TEXT"}` +
        `${c.notnull ? " NOT NULL" : ""};`,
    );
  }
  for (const c of diff.removed) {
    out.push(`ALTER TABLE ${t} DROP COLUMN ${quoteIdentifier(c.name)};`);
  }
  for (const c of diff.changed) {
    // ALTER COLUMN type syntax varies by engine, so surface it as a note rather
    // than emit something that may be wrong on the target.
    out.push(
      `-- ${table}.${c.name}: tipo ${c.from} -> ${c.to} ` +
        `(cambio de tipo; ALTER COLUMN varía por motor, revisar manualmente)`,
    );
  }
  return out;
}

/**
 * A schema endpoint: its table list and the structure of a given table. Injected
 * so the orchestration below is testable without a live connection (the compare
 * UI wires these to schema.tree / schema.describe on each connection).
 */
export interface SchemaEndpoint {
  tables(): Promise<string[]>;
  structure(table: string): Promise<ColumnDef[]>;
}

/**
 * Compute the migration statements that would make TARGET match SOURCE: CREATE
 * for source-only tables, ADD/DROP/notes for column diffs of common tables, and
 * a (non-destructive) note for target-only tables. Returns the statements in a
 * sensible order plus the table diff for a summary. Comment lines (`--`) are not
 * executable and are meant for the human reading the preview.
 */
export async function buildSchemaSync(
  source: SchemaEndpoint,
  target: SchemaEndpoint,
): Promise<{ statements: string[]; tableDiff: TableDiff }> {
  const [srcTables, tgtTables] = await Promise.all([
    source.tables(),
    target.tables(),
  ]);
  const tableDiff = diffTableLists(srcTables, tgtTables);
  const statements: string[] = [];

  for (const t of tableDiff.onlyInSource) {
    statements.push(generateCreateTable(t, await source.structure(t)));
  }
  for (const t of tableDiff.common) {
    const [sc, tc] = await Promise.all([
      source.structure(t),
      target.structure(t),
    ]);
    const cd = diffColumns(sc, tc);
    if (!columnDiffEmpty(cd)) {
      statements.push(...generateColumnMigration(t, cd));
    }
  }
  for (const t of tableDiff.onlyInTarget) {
    statements.push(
      `-- tabla ${t} existe en destino pero no en origen ` +
        `(DROP TABLE omitido por seguridad; revisar manualmente)`,
    );
  }
  return { statements, tableDiff };
}

/** Whether a generated line is an executable statement (not a comment). */
export function isExecutable(statement: string): boolean {
  return !statement.trimStart().startsWith("--");
}
