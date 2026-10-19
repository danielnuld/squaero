// Running a list of statements one by one with a status per statement (R-15,
// issue #692): the apply step of structure sync shows «Aplicada · 4 ms»,
// «Ejecutando», «Excluida · elimina datos» or the engine's error on each line.
// The transaction around it is the caller's; this only runs, times, stops at
// the first failure and honours a Cancelar between statements.

export type StepStatus =
  | { state: "pending" }
  | { state: "running" }
  | { state: "done"; ms: number }
  | { state: "failed"; message: string }
  /** Not run on purpose (a data-losing statement left unchecked). */
  | { state: "excluded" }
  /** Not reached: an earlier one failed or the run was cancelled. */
  | { state: "notRun" };

export interface StepsOutcome {
  /** How many statements ran to completion. */
  done: number;
  /** Index of the statement that failed, if one did. */
  failedAt: number | null;
  cancelled: boolean;
}

/**
 * Run `statements` in order through `exec`, skipping the indexes in `excluded`.
 * Each status change is reported through `onStatus`; the first failure stops
 * the run and marks the rest «notRun», as does an abort of `signal` (checked
 * before each statement, so the one in flight finishes).
 */
export async function runStatements(
  statements: readonly string[],
  exec: (sql: string, index: number) => Promise<void>,
  onStatus: (index: number, status: StepStatus) => void,
  opts: { excluded?: ReadonlySet<number>; signal?: AbortSignal; now?: () => number } = {},
): Promise<StepsOutcome> {
  const now = opts.now ?? (() => performance.now());
  let done = 0;
  const stopFrom = (i: number) => {
    for (let j = i; j < statements.length; j++) {
      if (!opts.excluded?.has(j)) onStatus(j, { state: "notRun" });
    }
  };
  for (let i = 0; i < statements.length; i++) {
    if (opts.excluded?.has(i)) {
      onStatus(i, { state: "excluded" });
      continue;
    }
    if (opts.signal?.aborted) {
      stopFrom(i);
      return { done, failedAt: null, cancelled: true };
    }
    onStatus(i, { state: "running" });
    const t0 = now();
    try {
      await exec(statements[i], i);
    } catch (err) {
      onStatus(i, { state: "failed", message: err instanceof Error ? err.message : String(err) });
      stopFrom(i + 1);
      return { done, failedAt: i, cancelled: false };
    }
    onStatus(i, { state: "done", ms: Math.round(now() - t0) });
    done++;
  }
  return { done, failedAt: null, cancelled: false };
}
