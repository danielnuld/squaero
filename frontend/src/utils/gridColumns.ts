// Pure helpers for result-grid column sizing (design proposal, phase 6).
// Kept out of the component so the width math is unit-tested and never coupled
// to the DOM. The grid consumes computeColumnWidths for the initial layout and
// resizeColumn for interactive drag.

export const MIN_COL_WIDTH = 60;
export const MAX_AUTO_WIDTH = 420;
export const DEFAULT_COL_WIDTH = 180;

export interface ColumnMeta {
  name: string;
  type?: string;
}

export interface WidthOptions {
  /** How many leading rows to sample for content width (perf: the grid may hold
      thousands of rows, but a small sample is enough to size a column). */
  sample?: number;
  /** Approximate width of one monospace character at the grid font size. */
  charPx?: number;
  /** Fixed chrome per cell: horizontal padding + border + (header) sort glyph. */
  padPx?: number;
  /** Lower / upper clamp for the auto-computed width. */
  min?: number;
  maxAuto?: number;
}

const DEFAULTS: Required<WidthOptions> = {
  sample: 50,
  charPx: 7,
  padPx: 28,
  min: MIN_COL_WIDTH,
  maxAuto: MAX_AUTO_WIDTH,
};

/** Longest visible length of a value once rendered as a grid cell. NULL renders
    as the literal "NULL" (4 chars); everything else by its string length. */
function cellLen(value: string | null): number {
  if (value === null) return 4; // "NULL"
  return value.length;
}

/**
 * Estimate each column's natural width in pixels from its header (name + type
 * label) and a sample of its cell values, using an average character width.
 * The result is clamped to [min, maxAuto] so one very long cell can't blow the
 * layout and an empty column still gets a usable minimum. Deterministic and
 * DOM-free — the grid measures nothing, it just trusts this heuristic.
 */
export function computeColumnWidths(
  columns: ColumnMeta[],
  rows: (string | null)[][],
  opts: WidthOptions = {},
): number[] {
  const o = { ...DEFAULTS, ...opts };
  const sampleCount = Math.min(rows.length, Math.max(0, o.sample));
  return columns.map((col, ci) => {
    // Header contributes the name plus the (shorter, uppercased) type label and
    // a little room for the sort glyph; take the longer of name and type line.
    const headerLen = Math.max(col.name.length, (col.type ?? "").length);
    let maxLen = headerLen;
    for (let r = 0; r < sampleCount; r++) {
      const len = cellLen(rows[r]?.[ci] ?? null);
      if (len > maxLen) maxLen = len;
    }
    const px = maxLen * o.charPx + o.padPx;
    return Math.round(Math.min(o.maxAuto, Math.max(o.min, px)));
  });
}

/**
 * Return a new widths array with column `index` resized by `delta` pixels,
 * clamped to `min`. Out-of-range indices and non-finite deltas are ignored
 * (returns the array unchanged) so a stray drag event can never corrupt state.
 */
export function resizeColumn(
  widths: number[],
  index: number,
  delta: number,
  min = MIN_COL_WIDTH,
): number[] {
  if (index < 0 || index >= widths.length || !Number.isFinite(delta)) {
    return widths;
  }
  const next = widths.slice();
  next[index] = Math.round(Math.max(min, widths[index] + delta));
  return next;
}
