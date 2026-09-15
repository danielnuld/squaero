// Pure state + planning for an in-grid edit session (M7). The component holds a
// PendingChanges value in a signal and calls these helpers to record cell edits,
// row deletions and inserted rows; buildPlan turns the accumulated changes into
// the ordered row.* operations to apply on commit. All pure and unit-tested; the
// component wiring (tx, preview dialog, applying the plan) stays thin.

import type { ResultColumn } from "./query";
import { whereForRow } from "./edit";
import type { PkMode } from "./rowPaste";

/** The table a result was read from, plus its primary key (empty => read-only). */
export interface EditSource {
  table: string;
  db?: string;
  schema?: string;
  pk: string[];
}

/** Accumulated, not-yet-applied changes to a result set. */
export interface PendingChanges {
  /** rowIndex -> { column -> new value } for edited existing rows. */
  edits: Record<number, Record<string, string | null>>;
  /** row indices marked for deletion. */
  deletes: number[];
  /** new rows, each a { column -> value } map. */
  inserts: Record<string, string | null>[];
  /** Parallel to `inserts`: the pasted batch a row came in with, or null for a
      row added by hand. Absent until the first batch. */
  insertBatch?: (number | null)[];
  /** batch -> what its rows do with the primary key they carry. */
  pkModes?: Record<number, PkMode>;
  /** batch -> whether its empty cells were taken as NULL. Only batches pasted
      as text have an entry: an exact copy knows NULL from "" already. */
  emptyAsNull?: Record<number, boolean>;
}

/** Neutral column type per name, so the driver can emit numeric columns unquoted
    (e.g. MySQL rejects a quoted string for a BIT column). */
export type ColumnTypes = Record<string, string>;

/** One operation to apply on commit, shaped for the edit.ts row.* wrappers.
    `setTypes` is optional — when absent the driver quotes every value (as before). */
export type PlanItem =
  | {
      kind: "update";
      set: Record<string, string | null>;
      where: Record<string, string | null>;
      setTypes?: ColumnTypes;
    }
  | { kind: "delete"; where: Record<string, string | null> }
  | {
      kind: "insert";
      values: Record<string, string | null>;
      setTypes?: ColumnTypes;
      /** Which pending row this came from, to point at it when it fails. Not
          sent to the core: runPlanItem passes fields one by one. */
      insertIndex?: number;
    };

/** An empty change set. */
export function emptyPending(): PendingChanges {
  return { edits: {}, deletes: [], inserts: [] };
}

/** Record (or clear) a new value for a cell of an existing row. Immutable. */
export function setCell(
  state: PendingChanges,
  rowIndex: number,
  column: string,
  value: string | null,
): PendingChanges {
  const rowEdits = { ...(state.edits[rowIndex] ?? {}), [column]: value };
  return { ...state, edits: { ...state.edits, [rowIndex]: rowEdits } };
}

/** Toggle whether an existing row is marked for deletion. Immutable. */
export function toggleDelete(state: PendingChanges, rowIndex: number): PendingChanges {
  const has = state.deletes.includes(rowIndex);
  return {
    ...state,
    deletes: has
      ? state.deletes.filter((i) => i !== rowIndex)
      : [...state.deletes, rowIndex],
  };
}

/** The batch of every inserted row, filling in null for rows added before any. */
function batchesOf(state: PendingChanges): (number | null)[] {
  return state.inserts.map((_, i) => state.insertBatch?.[i] ?? null);
}

/** Append a blank inserted row. Immutable. */
export function addInsert(state: PendingChanges): PendingChanges {
  return {
    ...state,
    inserts: [...state.inserts, {}],
    ...(state.insertBatch ? { insertBatch: [...batchesOf(state), null] } : {}),
  };
}

/**
 * Append several rows as one pasted batch, whose primary key starts in
 * `pkMode`. Pass `emptyAsNull` for rows parsed from text, so the choice can be
 * switched afterwards (setBatchEmptyAsNull). Immutable.
 */
export function addInserts(
  state: PendingChanges,
  rows: Record<string, string | null>[],
  pkMode: PkMode,
  emptyAsNull?: boolean,
): PendingChanges {
  const modes = state.pkModes ?? {};
  const batch = Object.keys(modes).reduce((max, k) => Math.max(max, Number(k) + 1), 0);
  return {
    ...state,
    inserts: [...state.inserts, ...rows.map((r) => ({ ...r }))],
    insertBatch: [...batchesOf(state), ...rows.map(() => batch)],
    pkModes: { ...modes, [batch]: pkMode },
    ...(emptyAsNull === undefined
      ? {}
      : { emptyAsNull: { ...(state.emptyAsNull ?? {}), [batch]: emptyAsNull } }),
  };
}

/**
 * Switch a text batch between reading empty cells as NULL and as "". Pasted
 * text has no NULL of its own, so every NULL in the batch came from an empty
 * cell and flipping is exact. A batch that did not come from text is returned
 * unchanged. Immutable.
 */
export function setBatchEmptyAsNull(
  state: PendingChanges,
  batch: number,
  on: boolean,
): PendingChanges {
  const current = state.emptyAsNull?.[batch];
  if (current === undefined || current === on) return state;
  const inserts = state.inserts.map((row, i) =>
    insertBatchOf(state, i) !== batch
      ? row
      : Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, on ? (v === "" ? null : v) : (v ?? "")]),
        ),
  );
  return { ...state, inserts, emptyAsNull: { ...state.emptyAsNull, [batch]: on } };
}

/** Drop every row of a batch (handing a paste to the import wizard). Immutable. */
export function removeBatch(state: PendingChanges, batch: number): PendingChanges {
  const keep = state.inserts.map((_, i) => insertBatchOf(state, i) !== batch);
  return {
    ...state,
    inserts: state.inserts.filter((_, i) => keep[i]),
    insertBatch: batchesOf(state).filter((_, i) => keep[i]),
  };
}

/** The most recent batch still holding a row, or null. */
export function lastBatch(state: PendingChanges): number | null {
  for (let i = state.inserts.length - 1; i >= 0; i--) {
    const batch = insertBatchOf(state, i);
    if (batch !== null) return batch;
  }
  return null;
}

/** The pasted batch an inserted row belongs to, or null. */
export function insertBatchOf(state: PendingChanges, insertIndex: number): number | null {
  return state.insertBatch?.[insertIndex] ?? null;
}

/** What an inserted row does with its primary key ("keep" for a hand-made row). */
export function pkModeOf(state: PendingChanges, insertIndex: number): PkMode {
  const batch = insertBatchOf(state, insertIndex);
  return batch === null ? "keep" : (state.pkModes?.[batch] ?? "keep");
}

/** Switch a batch between generating and keeping its primary key. Immutable. */
export function setPkMode(state: PendingChanges, batch: number, mode: PkMode): PendingChanges {
  return { ...state, pkModes: { ...(state.pkModes ?? {}), [batch]: mode } };
}

/** Set a cell of an inserted row (by its index in `inserts`). Immutable. */
export function setInsertCell(
  state: PendingChanges,
  insertIndex: number,
  column: string,
  value: string | null,
): PendingChanges {
  const inserts = state.inserts.map((r, i) =>
    i === insertIndex ? { ...r, [column]: value } : r,
  );
  return { ...state, inserts };
}

/** Drop an inserted row (by its index in `inserts`). Immutable. */
export function removeInsert(state: PendingChanges, insertIndex: number): PendingChanges {
  return {
    ...state,
    inserts: state.inserts.filter((_, i) => i !== insertIndex),
    ...(state.insertBatch
      ? { insertBatch: batchesOf(state).filter((_, i) => i !== insertIndex) }
      : {}),
  };
}

/** True when there is at least one edit, deletion or insert to apply. */
export function hasChanges(state: PendingChanges): boolean {
  return (
    state.deletes.length > 0 ||
    state.inserts.length > 0 ||
    Object.values(state.edits).some((e) => Object.keys(e).length > 0)
  );
}

/** Number of rows affected by the pending changes (edited + deleted + inserted). */
export function changeCount(state: PendingChanges): number {
  const edited = Object.entries(state.edits).filter(
    ([idx, e]) =>
      Object.keys(e).length > 0 && !state.deletes.includes(Number(idx)),
  ).length;
  return edited + state.deletes.length + state.inserts.length;
}

/**
 * Turn the pending changes into the ordered list of row.* operations to apply:
 * updates, then deletes, then inserts (deletes precede inserts so re-using a
 * primary-key value in the same batch does not collide). A row that is both
 * edited and deleted is only deleted. Existing-row ops are keyed by the row's
 * ORIGINAL primary key (via whereForRow); a row whose key is not projected by
 * the SELECT is skipped for updates/deletes (the caller keeps such tables
 * read-only, so this is a defensive guard). Inserts with no values are dropped.
 */
export function buildPlan(
  source: EditSource,
  columns: ResultColumn[],
  rows: (string | null)[][],
  state: PendingChanges,
): PlanItem[] {
  const plan: PlanItem[] = [];
  const deleted = new Set(state.deletes);
  // Column -> neutral type, so each op can carry the types of the columns it sets.
  const colType: ColumnTypes = {};
  for (const c of columns) colType[c.name] = c.type;
  const typesFor = (keys: string[]): ColumnTypes => {
    const t: ColumnTypes = {};
    for (const k of keys) if (k in colType) t[k] = colType[k];
    return t;
  };

  for (const [idxStr, set] of Object.entries(state.edits)) {
    const idx = Number(idxStr);
    if (deleted.has(idx) || Object.keys(set).length === 0) {
      continue;
    }
    const row = rows[idx];
    const where = row ? whereForRow(columns, row, source.pk) : null;
    if (where !== null) {
      plan.push({ kind: "update", set, where, setTypes: typesFor(Object.keys(set)) });
    }
  }

  for (const idx of state.deletes) {
    const row = rows[idx];
    const where = row ? whereForRow(columns, row, source.pk) : null;
    if (where !== null) {
      plan.push({ kind: "delete", where });
    }
  }

  const pkLower = source.pk.map((k) => k.toLowerCase());
  state.inserts.forEach((row, insertIndex) => {
    // A batch that generates its key leaves the key columns out, so the
    // database assigns them; the copied values stay in the pending row in case
    // the user switches back to keeping them.
    const values =
      pkModeOf(state, insertIndex) === "generate"
        ? Object.fromEntries(
            Object.entries(row).filter(([k]) => !pkLower.includes(k.toLowerCase())),
          )
        : row;
    if (Object.keys(values).length > 0) {
      plan.push({ kind: "insert", values, setTypes: typesFor(Object.keys(values)), insertIndex });
    }
  });

  return plan;
}
