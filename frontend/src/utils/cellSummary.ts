// The status-bar summary of the selected cells (issue #670): how many, and for
// a numeric column their sum, average, minimum and maximum.
//
// Which statistics apply is decided by the column's neutral TYPE, never by
// sniffing the values (.rules/frontend.md §3): a text column full of digits is
// still text, so it gets a count and nothing else. A numeric column holding a
// value that is not a plain number ("NaN", "Infinity", an engine's own
// spelling) also falls back to the count — a sum that silently skipped a cell
// would be a wrong number on screen.
//
// The arithmetic is exact. The core sends decimals as text precisely because
// they do not survive a float, so they are added as scaled BigInts: 0.1 + 0.2
// is "0.3", and a bigint id column sums without losing its last digits.

import { classifyType } from "./format";

export interface CellSummary {
  /** Cells in the selection, NULLs included. */
  count: number;
  /** How many of them are SQL NULL; the statistics below ignore them. */
  nulls: number;
  /** Exact sum, numeric columns only. */
  sum?: string;
  /** Average over the non-NULL cells, numeric columns only. */
  avg?: string;
  /** Smallest / largest value, as the core sent it. Numeric columns, and
      date/time columns whose values are all ISO-shaped. */
  min?: string;
  max?: string;
}

/** A decimal as an integer mantissa and a count of fractional digits:
    value = m / 10^s, with s >= 0. */
interface Dec {
  m: bigint;
  s: number;
}

/** Exponents beyond this are not a number any column of ours holds. */
const MAX_EXP = 400;
/** Extra fractional digits an average is computed to before trimming. */
const AVG_DIGITS = 10;

const NUMBER_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function parseDec(text: string): Dec | null {
  const m = NUMBER_RE.exec(text.trim());
  if (!m) return null;
  const [, sign, whole, frac = "", exp = "0"] = m;
  if (whole === "" && frac === "") return null;
  const e = Number(exp);
  if (Math.abs(e) > MAX_EXP) return null;
  let mant = BigInt((whole || "0") + frac);
  let s = frac.length - e;
  if (s < 0) {
    mant *= 10n ** BigInt(-s);
    s = 0;
  }
  return { m: sign === "-" ? -mant : mant, s };
}

const scaleTo = (d: Dec, s: number): bigint => d.m * 10n ** BigInt(s - d.s);

/** Renders m / 10^s, dropping trailing fractional zeros below `keep` digits. */
function formatDec(m: bigint, s: number, keep = s): string {
  const neg = m < 0n;
  const digits = (neg ? -m : m).toString().padStart(s + 1, "0");
  const whole = digits.slice(0, digits.length - s);
  let frac = digits.slice(digits.length - s);
  while (frac.length > keep && frac.endsWith("0")) frac = frac.slice(0, -1);
  const out = frac ? `${whole}.${frac}` : whole;
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

/** Integer division rounding half away from zero. */
function divRound(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  if (2n * (r < 0n ? -r : r) >= b) return q + (a < 0n ? -1n : 1n);
  return q;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const ISO_TIME = /^\d{2}:\d{2}/;

/**
 * Summarizes one column's selected cells. `values` are the raw cell strings
 * (null = SQL NULL); `type` is the column's neutral type.
 */
export function summarizeCells(values: readonly (string | null)[], type: string): CellSummary {
  const present = values.filter((v): v is string => v !== null);
  const out: CellSummary = { count: values.length, nulls: values.length - present.length };
  if (present.length === 0) return out;

  const kind = classifyType(type);
  if (kind === "number") {
    const decs = present.map(parseDec);
    if (decs.some((d) => d === null)) return out;
    const nums = decs as Dec[];
    const s = Math.max(...nums.map((d) => d.s));
    const scaled = nums.map((d) => scaleTo(d, s));
    let sum = 0n;
    let lo = 0;
    let hi = 0;
    scaled.forEach((v, i) => {
      sum += v;
      if (v < scaled[lo]) lo = i;
      if (v > scaled[hi]) hi = i;
    });
    const avgScale = s + AVG_DIGITS;
    const avg = divRound(sum * 10n ** BigInt(AVG_DIGITS), BigInt(nums.length));
    return {
      ...out,
      sum: formatDec(sum, s),
      avg: formatDec(avg, avgScale, s),
      min: present[lo].trim(),
      max: present[hi].trim(),
    };
  }

  if (kind === "temporal") {
    // ISO dates and times order correctly as strings; anything else (an
    // Informix DBDATE like 02/14/2023) cannot be ordered without guessing its
    // layout, so it gets the count only. ponytail: values with different UTC
    // offsets compare by their local text, convert to UTC if that ever matters.
    const iso = present.every((v) => ISO_DATE.test(v)) || present.every((v) => ISO_TIME.test(v));
    if (!iso) return out;
    const sorted = [...present].sort();
    return { ...out, min: sorted[0], max: sorted[sorted.length - 1] };
  }

  return out;
}

/**
 * Summarizes a block of cells over several columns (issue #690). The
 * statistics only apply when every column is of the same kind — a sum over a
 * price and a date is no number at all — so a mixed block gets the count and
 * the NULLs, and nothing else.
 */
export function summarizeRange(
  columns: readonly { values: readonly (string | null)[]; type: string }[],
): CellSummary {
  const all = columns.flatMap((c) => c.values);
  const kinds = new Set(columns.map((c) => classifyType(c.type)));
  if (kinds.size === 1) return summarizeCells(all, columns[0].type);
  return { count: all.length, nulls: all.filter((v) => v === null).length };
}
