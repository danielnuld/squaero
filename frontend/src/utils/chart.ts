// Pure charting helpers for result visualization (issue #149). A loaded result
// set is turned into a small set of named numeric series against a shared label
// axis; the ChartView component renders them as bars / lines / a pie with inline
// SVG (no chart library — keeps the bundle small and every computation testable).
// All geometry (scales, bar rects, line points, pie slices) is pure here; the
// component only maps these to SVG elements and the theme palette.

import type { ResultSet } from "./query";
import { classifyType } from "./format";

export type ChartType = "bar" | "line" | "pie";

/** One numeric series: a name (the source column) and one value per label. */
export interface ChartSeries {
  name: string;
  values: number[];
}

/** Extracted chart data: shared labels (x axis) + one series per value column. */
export interface ChartData {
  labels: string[];
  series: ChartSeries[];
}

/** Parse a cell to a finite number, or null when it is not numeric. */
export function toNumber(v: string | null): number | null {
  if (v === null) return null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * A sensible default column pick: the first non-numeric column as the label axis
 * (falling back to column 0), and the first numeric column as the single value
 * series (falling back to none). Numeric-ness uses the column's neutral type.
 */
export function defaultColumns(result: ResultSet): { labelCol: number; valueCols: number[] } {
  const numeric = result.columns.map((c) => classifyType(c.type) === "number");
  const labelCol = numeric.findIndex((n) => !n);
  const firstValue = numeric.findIndex((n) => n);
  return {
    labelCol: labelCol >= 0 ? labelCol : 0,
    valueCols: firstValue >= 0 ? [firstValue] : [],
  };
}

/**
 * Build chart data from a result: labels come from `labelCol` (cells shown
 * verbatim, NULL -> "∅"), and each column in `valueCols` becomes a series whose
 * non-numeric / NULL cells are 0 so the axis stays continuous.
 */
export function buildChartData(
  result: ResultSet,
  labelCol: number,
  valueCols: number[],
): ChartData {
  const labels = result.rows.map((r) => r[labelCol] ?? "∅");
  const series = valueCols.map((ci) => ({
    name: result.columns[ci]?.name ?? `col ${ci}`,
    values: result.rows.map((r) => toNumber(r[ci]) ?? 0),
  }));
  return { labels, series };
}

/** The maximum value across every series (0 for empty data). Used for the y max. */
export function seriesMax(series: ChartSeries[]): number {
  let m = 0;
  for (const s of series) for (const v of s.values) if (v > m) m = v;
  return m;
}

/** The minimum value across every series (0 when all values are non-negative). */
export function seriesMin(series: ChartSeries[]): number {
  let m = 0;
  for (const s of series) for (const v of s.values) if (v < m) m = v;
  return m;
}

/**
 * A "nice" axis bound at or above `max`: 0 for non-positive input, else the value
 * rounded up to 1/2/5 × a power of ten (so ticks land on round numbers).
 */
export function niceMax(max: number): number {
  if (max <= 0) return 0;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * pow;
}

/** Evenly spaced tick values from 0 to `max` inclusive (count+1 values). */
export function axisTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  return Array.from({ length: count + 1 }, (_, i) => (max * i) / count);
}

export interface PieSlice {
  /** Fraction of the whole [0,1]. */
  frac: number;
  /** Cumulative start / end angle in radians, clockwise from 12 o'clock. */
  start: number;
  end: number;
}

/**
 * Pie slice angles from a list of values. Negative values are clamped to 0; an
 * all-zero total yields zero-width slices (the component shows an empty state).
 * Angles start at -90° (12 o'clock) and go clockwise.
 */
export function pieSlices(values: number[]): PieSlice[] {
  const clamped = values.map((v) => (v > 0 ? v : 0));
  const total = clamped.reduce((a, b) => a + b, 0);
  const slices: PieSlice[] = [];
  let angle = -Math.PI / 2;
  for (const v of clamped) {
    const frac = total > 0 ? v / total : 0;
    const start = angle;
    const end = angle + frac * 2 * Math.PI;
    slices.push({ frac, start, end });
    angle = end;
  }
  return slices;
}

/** SVG coordinates of a point on a circle at `angle` (radians) from center. */
export function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/** The SVG path `d` for a pie/donut slice between two angles. */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const a = polar(cx, cy, r, start);
  const b = polar(cx, cy, r, end);
  const large = end - start > Math.PI ? 1 : 0;
  // A near-full circle can't be a single arc; approximate 100% as two half arcs.
  if (end - start >= 2 * Math.PI - 1e-6) {
    const mid = polar(cx, cy, r, start + Math.PI);
    return `M ${cx} ${cy} L ${a.x} ${a.y} A ${r} ${r} 0 1 1 ${mid.x} ${mid.y} A ${r} ${r} 0 1 1 ${a.x} ${a.y} Z`;
  }
  return `M ${cx} ${cy} L ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y} Z`;
}
