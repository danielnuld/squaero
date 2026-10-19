// The sections of a table's structure view (audit A-28): columns with readable
// headers and what keys or indexes each one takes part in, the indexes, the
// foreign keys both ways and the triggers. Every catalog answer arrives in the
// shape its own helper defines (schema.describe's neutral columns, indexListFor,
// foreignKeysFor, the triggers listing); this file only reads those shapes, so
// the view stays presentational and the reading is tested without a DOM.

import type { ResultSet } from "./query";
import type { ForeignKeyRelation } from "./foreignKeys";
import { columnsFromDescribe } from "./tableDesign";

/** One column as the structure view lists it. */
export interface StructColumn {
  name: string;
  type: string;
  nullable: boolean;
  /** The engine's default expression, "" when there is none. */
  defaultValue: string;
  pk: boolean;
}

/**
 * The columns of a schema.describe result, or null when the result does not
 * carry the neutral `name` column (the view then shows it as it came).
 */
export function structColumns(rs: ResultSet): StructColumn[] | null {
  const pkIdx = rs.columns.findIndex((c) => c.name === "pk");
  if (!rs.columns.some((c) => c.name === "name")) return null;
  const nameIdx = rs.columns.findIndex((c) => c.name === "name");
  const pkOf = new Map<string, boolean>();
  for (const row of rs.rows) {
    const v = pkIdx < 0 ? null : row[pkIdx];
    // SQLite numbers the key columns (1, 2…); the others answer 1/0.
    pkOf.set(row[nameIdx] ?? "", v != null && v !== "" && v !== "0" && v !== "false");
  }
  return columnsFromDescribe(rs).map((c) => ({ ...c, pk: pkOf.get(c.name) ?? false }));
}

/** One index of the table. `null` means the catalog does not say. */
export interface StructIndex {
  name: string;
  columns: string[] | null;
  unique: boolean | null;
}

const yes = (v: string | null | undefined): boolean | null => {
  if (v == null || v === "") return null;
  return /^(s[ií]|yes|true|1)$/i.test(v.trim());
};

/**
 * The indexes of an indexListFor result. MySQL and SQLite list the columns and
 * a Sí/No flag, PostgreSQL only the definition (read here), Informix the flag
 * alone and MongoDB the key document.
 */
export function structIndexes(rs: ResultSet): StructIndex[] {
  const col = (n: string) => rs.columns.findIndex((c) => c.name.toLowerCase() === n);
  const ni = col("name");
  if (ni < 0) return [];
  const ci = col("columnas");
  const ui = col("unico") >= 0 ? col("unico") : col("unique");
  const di = col("definicion");
  const ki = col("key");
  return rs.rows.map((row) => {
    let columns: string[] | null = null;
    let unique = ui >= 0 ? yes(row[ui]) : null;
    if (ci >= 0 && row[ci]) columns = row[ci]!.split(",").map((s) => s.trim());
    if (di >= 0 && row[di]) {
      const def = row[di]!;
      const m = /\busing\s+\w+\s*\((.*)\)/i.exec(def);
      if (m) columns = m[1].split(",").map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
      unique = /^\s*create\s+unique\b/i.test(def);
    }
    if (ki >= 0 && row[ki]) {
      try {
        columns = Object.keys(JSON.parse(row[ki]!) as Record<string, unknown>);
      } catch {
        /* not JSON: leave the columns unknown */
      }
      // MongoDB omits `unique` unless it is set.
      if (unique === null) unique = false;
    }
    return { name: (row[ni] ?? "").trim(), columns, unique };
  });
}

/** What a column takes part in, for the «Clave / índice» cell. */
export type KeyNote =
  | { kind: "pk" }
  | { kind: "unique" | "index"; name: string }
  | { kind: "fk"; table: string; column: string };

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()));

/**
 * The keys and indexes one column takes part in. The index that IS the primary
 * key (MySQL's PRIMARY, PostgreSQL's _pkey, SQLite's autoindex) is not said
 * twice. An index whose columns the catalog does not give is not attributed.
 */
export function columnKeys(
  column: string,
  pkColumns: string[],
  indexes: StructIndex[],
  outbound: ForeignKeyRelation[],
): KeyNote[] {
  const lc = column.toLowerCase();
  const notes: KeyNote[] = [];
  if (pkColumns.some((c) => c.toLowerCase() === lc)) notes.push({ kind: "pk" });
  for (const ix of indexes) {
    if (!ix.columns || !ix.columns.some((c) => c.toLowerCase() === lc)) continue;
    if (pkColumns.length && ix.unique && sameSet(ix.columns, pkColumns)) continue;
    notes.push({ kind: ix.unique ? "unique" : "index", name: ix.name });
  }
  for (const fk of outbound) {
    const pair = fk.columns.find((p) => p.from.toLowerCase() === lc);
    if (pair) notes.push({ kind: "fk", table: fk.toTable, column: pair.to });
  }
  return notes;
}

/** A trigger defined on the table. */
export interface StructTrigger {
  name: string;
  /** «AFTER INSERT», when the catalog says. */
  when: string | null;
}

/**
 * The triggers of ONE table out of a database-wide triggers listing (see
 * utils/triggers.ts). Null when the listing has no owning-table column, since
 * then which trigger belongs to which table cannot be told.
 */
export function triggersOn(
  table: string,
  rs: ResultSet,
  cols: { nameCol: string | null; tableCol: string | null },
): StructTrigger[] | null {
  const at = (n: string | null) => (n ? rs.columns.findIndex((c) => c.name === n) : -1);
  const ni = at(cols.nameCol);
  const ti = at(cols.tableCol);
  if (ni < 0 || ti < 0) return null;
  const timing = at("ACTION_TIMING");
  const event = at("EVENT_MANIPULATION");
  const lc = table.toLowerCase();
  return rs.rows
    .filter((r) => (r[ti] ?? "").trim().toLowerCase() === lc)
    .map((r) => {
      const when = [timing >= 0 ? r[timing] : null, event >= 0 ? r[event] : null]
        .filter(Boolean)
        .join(" ");
      return { name: (r[ni] ?? "").trim(), when: when || null };
    });
}
