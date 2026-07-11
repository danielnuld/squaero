// SQL notebook model (issue #262): a document of ordered cells, each SQL or
// Markdown, plus shared parameters substituted into the SQL before it runs. Pure
// and unit-tested — no DOM, no transport — so the Notebook component is a thin
// binding over this. Persistence is JSON (see notebookStore.ts); execution
// reuses runQuery; the grid reuses ResultGrid; charts reuse ChartView.

export type CellKind = "sql" | "markdown";

export interface Cell {
  /** Stable id within a notebook, of the form "cell-N". */
  id: string;
  kind: CellKind;
  /** The cell text: SQL to run, or Markdown to render. */
  source: string;
}

/** A shared variable, substituted into SQL cells as `:name`. */
export interface NotebookParam {
  name: string;
  value: string;
}

export interface Notebook {
  /** Stable id, for persistence and tab identity. */
  id: string;
  name: string;
  cells: Cell[];
  params: NotebookParam[];
}

/** Next "cell-N" id greater than every existing cell's numeric suffix. */
export function nextCellId(cells: Cell[]): string {
  const max = cells.reduce((acc, c) => {
    const m = /^cell-(\d+)$/.exec(c.id);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `cell-${max + 1}`;
}

/** A fresh cell of `kind` with a unique id relative to `cells`. */
export function newCell(cells: Cell[], kind: CellKind, source = ""): Cell {
  return { id: nextCellId(cells), kind, source };
}

/** A new, empty notebook with one blank SQL cell so it is immediately usable. */
export function newNotebook(id: string, name = "Notebook"): Notebook {
  return { id, name, cells: [{ id: "cell-1", kind: "sql", source: "" }], params: [] };
}

/** Insert `cell` after the cell with id `afterId` (at the end when not found). */
export function insertCellAfter(cells: Cell[], afterId: string, cell: Cell): Cell[] {
  const idx = cells.findIndex((c) => c.id === afterId);
  if (idx === -1) {
    return [...cells, cell];
  }
  return [...cells.slice(0, idx + 1), cell, ...cells.slice(idx + 1)];
}

/** Remove the cell with `id`. Never removes the last cell (a notebook keeps at
    least one), returning the list unchanged in that case. */
export function removeCell(cells: Cell[], id: string): Cell[] {
  if (cells.length <= 1) {
    return cells;
  }
  return cells.filter((c) => c.id !== id);
}

/** Replace the source of the cell with `id`. */
export function updateCellSource(cells: Cell[], id: string, source: string): Cell[] {
  return cells.map((c) => (c.id === id ? { ...c, source } : c));
}

/** Switch the kind of the cell with `id` (source is kept). */
export function setCellKind(cells: Cell[], id: string, kind: CellKind): Cell[] {
  return cells.map((c) => (c.id === id ? { ...c, kind } : c));
}

/** Move the cell with `id` by `dir` (-1 up, +1 down); no-op at the ends. */
export function moveCell(cells: Cell[], id: string, dir: -1 | 1): Cell[] {
  const idx = cells.findIndex((c) => c.id === id);
  if (idx === -1) {
    return cells;
  }
  const target = idx + dir;
  if (target < 0 || target >= cells.length) {
    return cells;
  }
  const next = cells.slice();
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

/**
 * Substitute shared parameters into a SQL string: each `:name` token is replaced
 * by the value of the matching param (raw text — the user controls quoting in the
 * value, e.g. a param value of `'2024-01-01'`). A `:name` with no matching param
 * is left untouched, and a PostgreSQL `::type` cast (double colon) is never
 * treated as a parameter. Only word-character names match (`:[A-Za-z_]\w*`).
 */
export function applyParams(sql: string, params: NotebookParam[]): string {
  if (params.length === 0) {
    return sql;
  }
  const byName = new Map(params.map((p) => [p.name, p.value]));
  // (^|[^:]) guards against `::` casts; the leading char is preserved.
  return sql.replace(/(^|[^:]):([A-Za-z_]\w*)/g, (whole, lead: string, name: string) => {
    return byName.has(name) ? lead + (byName.get(name) as string) : whole;
  });
}

/** JSON for storage. */
export function serializeNotebooks(list: Notebook[]): string {
  return JSON.stringify(list);
}

/** Coerce one parsed item into a Notebook, or null when malformed. */
export function coerceNotebook(item: unknown): Notebook | null {
  const n = item as Partial<Notebook> | null;
  if (!n || typeof n.id !== "string" || typeof n.name !== "string" || !Array.isArray(n.cells)) {
    return null;
  }
  const cells: Cell[] = [];
  for (const raw of n.cells) {
    const c = raw as Partial<Cell> | null;
    if (c && typeof c.id === "string" && (c.kind === "sql" || c.kind === "markdown") &&
        typeof c.source === "string") {
      cells.push({ id: c.id, kind: c.kind, source: c.source });
    }
  }
  if (cells.length === 0) {
    cells.push({ id: "cell-1", kind: "sql", source: "" });
  }
  const params: NotebookParam[] = [];
  if (Array.isArray(n.params)) {
    for (const raw of n.params) {
      const p = raw as Partial<NotebookParam> | null;
      if (p && typeof p.name === "string" && typeof p.value === "string") {
        params.push({ name: p.name, value: p.value });
      }
    }
  }
  return { id: n.id, name: n.name, cells, params };
}

/** Tolerant parse of stored notebooks; malformed entries are dropped. */
export function parseNotebooks(raw: string | null): Notebook[] {
  if (!raw) {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map(coerceNotebook).filter((n): n is Notebook => n !== null);
}

/** Next "nb-N" id unique within `existing`. */
export function nextNotebookId(existing: Notebook[]): string {
  const max = existing.reduce((acc, n) => {
    const m = /^nb-(\d+)$/.exec(n.id);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `nb-${max + 1}`;
}

/** Insert or replace a notebook by id, preserving order on replace. */
export function upsertNotebook(list: Notebook[], nb: Notebook): Notebook[] {
  const idx = list.findIndex((n) => n.id === nb.id);
  if (idx === -1) {
    return [...list, nb];
  }
  const next = list.slice();
  next[idx] = nb;
  return next;
}

/** Remove the notebook with `id`. */
export function removeNotebook(list: Notebook[], id: string): Notebook[] {
  return list.filter((n) => n.id !== id);
}
