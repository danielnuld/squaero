// The review grid of data sync (#692, P5): one line per change, the way the
// prototype's DataDiffResult reads — «UPDATE · 2 · saldo · 900.00 → 980.50»,
// a new row as «INSERT · 12 · (fila nueva) · → its values», a deleted one as
// «DELETE · 7 · (fila eliminada) · its values →». Pure: the wizard puts the
// catalog's words on the headers and the markers.

import type { ResultSet } from "./query";
import { keyOf, type DataDiff } from "./dataDiff";

export interface DiffRow {
  op: "INSERT" | "UPDATE" | "DELETE";
  /** The primary key's values, in `pk` order. */
  key: (string | null)[];
  /** The changed column; null for a whole row (insert or delete). */
  column: string | null;
  /** The target's value now (a deleted row: its values joined). */
  from: string | null;
  /** What it becomes (an inserted row: its values joined). */
  to: string | null;
}

/** A row's non-key values in column order, «a · b · NULL». */
function joined(rec: Record<string, string | null>, cols: string[]): string {
  return cols.map((c) => rec[c] ?? "NULL").join(" · ");
}

/**
 * The changes of `diff` as review lines. `target` is the target table as read
 * (for the values an UPDATE replaces and a DELETE removes); `columns` the
 * source's column order.
 */
export function diffRows(diff: DataDiff, target: ResultSet, pk: string[], columns: string[]): DiffRow[] {
  const nonKey = columns.filter((c) => !pk.includes(c));
  const byKey = new Map<string, Record<string, string | null>>();
  for (const row of target.rows) {
    const rec: Record<string, string | null> = {};
    target.columns.forEach((c, i) => (rec[c.name] = row[i] ?? null));
    byKey.set(keyOf(rec, pk), rec);
  }
  const keyVals = (rec: Record<string, string | null>) => pk.map((k) => rec[k] ?? null);
  const out: DiffRow[] = [];
  for (const values of diff.inserts) {
    out.push({ op: "INSERT", key: keyVals(values), column: null, from: null, to: joined(values, nonKey) });
  }
  for (const u of diff.updates) {
    const now = byKey.get(keyOf(u.where, pk)) ?? {};
    for (const [col, value] of Object.entries(u.set)) {
      out.push({ op: "UPDATE", key: keyVals(u.where), column: col, from: now[col] ?? null, to: value });
    }
  }
  for (const d of diff.deletes) {
    const now = byKey.get(keyOf(d.where, pk)) ?? {};
    out.push({ op: "DELETE", key: keyVals(d.where), column: null, from: joined(now, nonKey), to: null });
  }
  return out;
}

/** Source rows the target already has exactly: neither inserted nor updated. */
export function equalCount(sourceRows: number, diff: DataDiff): number {
  return Math.max(0, sourceRows - diff.inserts.length - diff.updates.length);
}
