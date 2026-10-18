// Compare two result sets (issue #669): which rows were added, removed or
// changed going from a BASE result (left, e.g. a pinned one) to another (right,
// e.g. the current run). Pure and unit-tested; the workspace draws the outcome
// in the ordinary virtualized grid.
//
// Rows are paired by a chosen KEY (one or more columns) or by POSITION. Only
// columns present on both sides are compared; the rest are reported. A key that
// appears more than once on a side is reported and its rows are marked
// "duplicate" — never collapsed onto one arbitrary partner. Only the rows each
// side has LOADED are compared, and the counts say so (no silent truncation).
//
// Equality is type-aware, from the neutral column types, when both sides agree
// on the column's kind:
// - number: the decimal value, so "1.0" = "1" = "01" and "-0" = "0". Plain
//   decimals compare as exact text after normalising (no float rounding, so
//   big ids and decimals stay exact); exponent forms ("1e3") go through Number.
// - bool: the 0/1 reading the grid already uses ("t" = "true" = "1").
// - anything else: exact text — case and whitespace count.
// NULL equals NULL only; NULL never equals "" (or anything else).
// Column names match exactly (the same query on the same engine names them the
// same way); a duplicated column name compares its first occurrence.

import type { ResultSet } from "./query";
import { boolTo01, classifyType, NULL_LABEL } from "./format";
import { keyOf } from "./dataDiff";

/** How rows are paired: by key columns, or row i with row i. */
export type CompareBy = { by: "position" } | { by: "key"; columns: string[] };

export type DiffStatus = "added" | "removed" | "changed" | "duplicate";

/** One differing row. `left` / `right` index the rows of each side. */
export interface DiffRow {
  status: DiffStatus;
  left: number | null;
  right: number | null;
  /** The compared columns whose values differ (a "changed" row only). */
  changed: string[];
}

export interface ResultComparison {
  /** Compared columns: those on both sides, in the left side's order. */
  columns: string[];
  /** Columns only one side has — reported, not compared. */
  onlyLeft: string[];
  onlyRight: string[];
  /** Key columns a side lacks. Non-empty means no row was compared. */
  missingKey: string[];
  /** The differences, left order first, then rows only the right side has. */
  rows: DiffRow[];
  /** Rows paired and equal on every compared column (not listed). */
  same: number;
  /** Distinct key values that occur more than once on either side. */
  duplicateKeys: number;
  /** Rows each side had loaded, and whether more existed beyond them. */
  loaded: { left: number; right: number };
  truncated: { left: boolean; right: boolean };
}

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** A numeric text as one canonical decimal string, or the input unchanged. */
function canonicalNumber(v: string): string {
  const s = v.trim();
  if (DECIMAL.test(s)) {
    const neg = s.startsWith("-");
    const [int = "", frac = ""] = s.replace(/^[+-]/, "").split(".");
    const i = int.replace(/^0+/, "") || "0";
    const f = frac.replace(/0+$/, "");
    const out = f ? `${i}.${f}` : i;
    return neg && out !== "0" ? `-${out}` : out;
  }
  // "1e3", "0x10": Number reads them; a result like "1e+21" stays as written.
  const n = Number(s);
  if (s === "" || !Number.isFinite(n)) return v;
  const t = String(n);
  return DECIMAL.test(t) ? canonicalNumber(t) : t;
}

/** The value as compared, for a column of the given kind. */
function normalize(v: string | null, kind: string): string | null {
  if (v === null) return null;
  if (kind === "number") return canonicalNumber(v);
  if (kind === "bool") return boolTo01(v);
  return v;
}

/** First index of each column name. */
function indexOf(rs: ResultSet): Map<string, number> {
  const m = new Map<string, number>();
  rs.columns.forEach((c, i) => {
    if (!m.has(c.name)) m.set(c.name, i);
  });
  return m;
}

export function compareResults(left: ResultSet, right: ResultSet, by: CompareBy): ResultComparison {
  const li = indexOf(left);
  const ri = indexOf(right);
  const columns = [...li.keys()].filter((c) => ri.has(c));
  const kind = new Map(
    columns.map((c) => {
      const a = classifyType(left.columns[li.get(c)!]!.type);
      const b = classifyType(right.columns[ri.get(c)!]!.type);
      return [c, a === b ? a : "text"];
    }),
  );
  const out: ResultComparison = {
    columns,
    onlyLeft: [...li.keys()].filter((c) => !ri.has(c)),
    onlyRight: [...ri.keys()].filter((c) => !li.has(c)),
    missingKey: by.by === "key" ? by.columns.filter((c) => !li.has(c) || !ri.has(c)) : [],
    rows: [],
    same: 0,
    duplicateKeys: 0,
    loaded: { left: left.rows.length, right: right.rows.length },
    truncated: { left: left.truncated, right: right.truncated },
  };
  if (out.missingKey.length > 0) return out;

  /** The row as normalized values by column name (compared columns only). */
  const rec = (rs: ResultSet, idx: Map<string, number>, r: number) => {
    const o: Record<string, string | null> = {};
    for (const c of columns) o[c] = normalize(rs.rows[r]?.[idx.get(c)!] ?? null, kind.get(c)!);
    return o;
  };
  const L = left.rows.map((_, r) => rec(left, li, r));
  const R = right.rows.map((_, r) => rec(right, ri, r));
  const pair = (l: number, r: number) => {
    const changed = columns.filter((c) => L[l]![c] !== R[r]![c]);
    if (changed.length > 0) out.rows.push({ status: "changed", left: l, right: r, changed });
    else out.same++;
  };

  if (by.by === "position") {
    for (let i = 0; i < Math.max(L.length, R.length); i++) {
      if (i >= R.length) out.rows.push({ status: "removed", left: i, right: null, changed: [] });
      else if (i >= L.length) out.rows.push({ status: "added", left: null, right: i, changed: [] });
      else pair(i, i);
    }
    return out;
  }

  const group = (recs: Record<string, string | null>[]) => {
    const m = new Map<string, number[]>();
    recs.forEach((r, i) => {
      const k = keyOf(r, by.columns);
      const list = m.get(k);
      if (list) list.push(i);
      else m.set(k, [i]);
    });
    return m;
  };
  const lk = group(L);
  const rk = group(R);
  const dup = (k: string) => (lk.get(k)?.length ?? 0) > 1 || (rk.get(k)?.length ?? 0) > 1;
  for (const k of new Set([...lk.keys(), ...rk.keys()])) if (dup(k)) out.duplicateKeys++;

  L.forEach((r, i) => {
    const k = keyOf(r, by.columns);
    const match = rk.get(k);
    if (dup(k)) out.rows.push({ status: "duplicate", left: i, right: null, changed: [] });
    else if (!match) out.rows.push({ status: "removed", left: i, right: null, changed: [] });
    else pair(i, match[0]!);
  });
  R.forEach((r, i) => {
    const k = keyOf(r, by.columns);
    if (dup(k)) out.rows.push({ status: "duplicate", left: null, right: i, changed: [] });
    else if (!lk.has(k)) out.rows.push({ status: "added", left: null, right: i, changed: [] });
  });
  return out;
}

/** The status column's mark for each kind of difference. */
export const DIFF_MARK: Record<DiffStatus, string> = {
  added: "+",
  removed: "−",
  changed: "~",
  duplicate: "!",
};

/** A comparison drawn as a plain result: a status column, then the compared columns. */
export interface ComparisonView {
  result: ResultSet;
  status: DiffStatus[];
  /** Per row, the VIEW column indices whose values changed. */
  changed: Set<number>[];
}

/**
 * The comparison as rows the grid can draw. A row takes the values of the side
 * it comes from (the right side for a changed row); a changed cell reads
 * "old → new", so both values are on screen without hovering.
 */
export function comparisonView(
  cmp: ResultComparison,
  left: ResultSet,
  right: ResultSet,
  statusHeader: string,
): ComparisonView {
  const li = indexOf(left);
  const ri = indexOf(right);
  const shown = (v: string | null) => v ?? NULL_LABEL;
  const status: DiffStatus[] = [];
  const changed: Set<number>[] = [];
  const rows = cmp.rows.map((d) => {
    status.push(d.status);
    const marks = new Set<number>();
    const cells = cmp.columns.map((c, i) => {
      const lv = d.left === null ? null : (left.rows[d.left]?.[li.get(c)!] ?? null);
      const rv = d.right === null ? null : (right.rows[d.right]?.[ri.get(c)!] ?? null);
      if (d.changed.includes(c)) {
        marks.add(i + 1);
        return `${shown(lv)} → ${shown(rv)}`;
      }
      return d.right === null ? lv : rv;
    });
    changed.push(marks);
    return [DIFF_MARK[d.status], ...cells];
  });
  const typeOf = (c: string) => left.columns[li.get(c)!]!.type;
  return {
    result: {
      columns: [{ name: statusHeader, type: "text" }, ...cmp.columns.map((c) => ({ name: c, type: typeOf(c) }))],
      rows,
      truncated: false,
      rowsAffected: 0,
    },
    status,
    changed,
  };
}
