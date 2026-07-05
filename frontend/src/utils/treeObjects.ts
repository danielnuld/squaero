// Pure logic for the object-type folders in the schema tree (issue #135, phase 2):
// besides Tablas/Vistas (phase 1, see tree.ts groupObjectsByType), a database can
// show lazy folders for Procedimientos / Funciones / Triggers / Eventos. These are
// NOT returned by the core (schema.tree) — they are listed on demand via query.run
// over catalogs, reusing the per-engine SQL from routines.ts and triggers.ts. This
// module decides which folders an engine shows and turns a listing result into leaf
// descriptors; the component runs the SQL and renders the nodes. All pure + tested.

import { routinesFor } from "./routines";
import { objectsFor } from "./triggers";

/** The object kind a lazy folder groups. */
export type ObjectGroupKind = "procedure" | "function" | "trigger" | "event";

/** A lazy object-type folder: its label and how to list + read its members. */
export interface FolderSpec {
  groupKind: ObjectGroupKind;
  label: string;
  listSql: string;
  nameCol: string;
  /** Column holding the routine type, when the listing mixes types (routines). */
  typeCol: string | null;
  /** Column holding the owning table (triggers), if any. */
  tableCol: string | null;
  /** Column holding a stable id for overload disambiguation, if any. */
  idCol: string | null;
  /** Keep only rows whose typeCol matches this (PROCEDURE/FUNCTION); null = all. */
  filterType: string | null;
  /** When set, the list row already carries the full DDL in this column
      (SQLite triggers) — no definition query is needed on click. */
  inlineDefCol: string | null;
}

/** A listed object, ready to become a leaf node and to fetch its definition. */
export interface ObjectLeaf {
  name: string;
  groupKind: ObjectGroupKind;
  /** Routine type (PROCEDURE/FUNCTION), for the definition query. */
  type?: string;
  /** Owning table (triggers). */
  table?: string;
  /** Stable catalog id (Informix procid/trigid). */
  id?: string;
  /** DDL already present in the listing row (SQLite triggers). */
  def?: string;
}

function family(engine: string): string {
  const e = engine.toLowerCase();
  if (e === "mysql" || e === "mariadb") return "mysql";
  if (e === "postgres" || e === "postgresql") return "postgres";
  return e;
}

/**
 * Which lazy object-type folders to show under a database container, and how to
 * list each. Only engines whose routines/triggers scope cleanly at the database
 * level are included (MySQL/MariaDB, SQLite, Informix). PostgreSQL namespaces
 * routines/triggers per schema, so its folders are omitted here (would need
 * per-schema scoping) — the tree still shows its Tablas/Vistas as before.
 */
export function objectFolders(engine: string, db?: string): FolderSpec[] {
  const f = family(engine);
  if (f !== "mysql" && f !== "sqlite" && f !== "informix") return [];

  const out: FolderSpec[] = [];
  const r = routinesFor(engine, db);
  if (r.supported && r.listSql && r.nameCol) {
    out.push({
      groupKind: "procedure",
      label: "Procedimientos",
      listSql: r.listSql,
      nameCol: r.nameCol,
      typeCol: r.typeCol,
      tableCol: null,
      idCol: r.idCol,
      filterType: "PROCEDURE",
      inlineDefCol: null,
    });
    out.push({
      groupKind: "function",
      label: "Funciones",
      listSql: r.listSql,
      nameCol: r.nameCol,
      typeCol: r.typeCol,
      tableCol: null,
      idCol: r.idCol,
      filterType: "FUNCTION",
      inlineDefCol: null,
    });
  }
  const t = objectsFor(engine, "trigger", db);
  if (t.supported && t.listSql && t.nameCol) {
    out.push({
      groupKind: "trigger",
      label: "Triggers",
      listSql: t.listSql,
      nameCol: t.nameCol,
      typeCol: null,
      tableCol: t.tableCol,
      idCol: t.idCol,
      filterType: null,
      inlineDefCol: t.inlineDefCol,
    });
  }
  const e = objectsFor(engine, "event", db);
  if (e.supported && e.listSql && e.nameCol) {
    out.push({
      groupKind: "event",
      label: "Eventos",
      listSql: e.listSql,
      nameCol: e.nameCol,
      typeCol: null,
      tableCol: null,
      idCol: null,
      filterType: null,
      inlineDefCol: null,
    });
  }
  return out;
}

/** The FolderSpec for a given group kind under an engine/db, or null. */
export function folderSpec(
  engine: string,
  db: string | undefined,
  groupKind: ObjectGroupKind,
): FolderSpec | null {
  return objectFolders(engine, db).find((f) => f.groupKind === groupKind) ?? null;
}

/** Turn a listing result into leaf descriptors, applying the folder's type
    filter (for routines) and pulling name/table/id from the mapped columns. */
export function objectLeaves(
  spec: FolderSpec,
  columns: string[],
  rows: (string | null)[][],
): ObjectLeaf[] {
  const idxOf = (name: string | null) =>
    name ? columns.findIndex((c) => c.toLowerCase() === name.toLowerCase()) : -1;
  const ni = idxOf(spec.nameCol);
  if (ni < 0) return [];
  const ti = idxOf(spec.typeCol);
  const tbi = idxOf(spec.tableCol);
  const ii = idxOf(spec.idCol);
  const di = idxOf(spec.inlineDefCol);
  const leaves: ObjectLeaf[] = [];
  for (const row of rows) {
    const name = row[ni];
    if (!name) continue;
    const typeVal = ti >= 0 ? (row[ti] ?? "") : "";
    if (spec.filterType && !typeVal.toUpperCase().includes(spec.filterType)) continue;
    leaves.push({
      name,
      groupKind: spec.groupKind,
      type: ti >= 0 ? (row[ti] ?? undefined) : undefined,
      table: tbi >= 0 ? (row[tbi] ?? undefined) : undefined,
      id: ii >= 0 ? (row[ii] ?? undefined) : undefined,
      def: di >= 0 ? (row[di] ?? undefined) : undefined,
    });
  }
  return leaves;
}

/** Extract the DDL text from a definition result: the named column of the first
    row, or all rows of that column concatenated (Informix multi-row bodies). */
export function readDefinitionText(
  columns: string[],
  rows: (string | null)[][],
  column: string,
  concatRows: boolean,
): string {
  const found = columns.findIndex((c) => c.toLowerCase() === column.toLowerCase());
  const idx = found >= 0 ? found : 0;
  return concatRows ? rows.map((r) => r[idx] ?? "").join("") : (rows[0]?.[idx] ?? "");
}
