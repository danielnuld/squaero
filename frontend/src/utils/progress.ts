// The progress model of a long wizard run (R-01, issue #692): import, transfer,
// generate, backup, apply. «2140 de 4812 filas · 44 % · quedan unos 8 s» — the
// figures are worked out here, so every wizard says them the same way and the
// arithmetic (no total yet, nothing done yet, done past total) is tested once.

export interface ProgressFacts {
  /** 0–100, whole; null while the total is not known (indeterminate bar). */
  percent: number | null;
  /** Items still to do; null while the total is not known. */
  remaining: number | null;
  /** Estimated time left, ms; null until there is a rate to go by. */
  etaMs: number | null;
}

/**
 * Where a run stands after `done` of `total` items in `elapsedMs`. The time left
 * is the plain average rate so far — honest enough for a row loop, and it says
 * nothing (null) until at least one item and a moment have passed, rather than
 * flashing an estimate made from nothing.
 */
export function progressFacts(done: number, total: number | null, elapsedMs: number): ProgressFacts {
  if (total === null || !Number.isFinite(total) || total <= 0) {
    return { percent: null, remaining: null, etaMs: null };
  }
  const d = Math.min(Math.max(done, 0), total);
  const remaining = total - d;
  const etaMs = d > 0 && elapsedMs > 0 ? Math.round((elapsedMs / d) * remaining) : null;
  return { percent: Math.floor((d / total) * 100), remaining, etaMs };
}

/** «unos 8 s», «unos 3 min»: the time left, rounded the way a person says it. */
export function etaParts(ms: number): { n: number; unit: "s" | "min" | "h" } {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return { n: s, unit: "s" };
  const min = Math.ceil(s / 60);
  if (min < 60) return { n: min, unit: "min" };
  return { n: Math.ceil(min / 60), unit: "h" };
}
