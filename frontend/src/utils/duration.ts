// Query-duration formatting + slow classification (issue #179). Client-side, so
// it works for every engine without any server catalog. Pure and tested; used by
// the status bar (last run) and the history panel (per-entry, slow marking).

/**
 * Human-readable duration. Sub-second shows whole milliseconds ("834 ms");
 * one second and above shows seconds with one decimal ("1.2 s", "12.0 s");
 * a minute and above shows "m s" ("1 m 5 s"). Negative/NaN render as "—".
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  return `${minutes} m ${seconds} s`;
}

/**
 * Whether a run counts as slow: its duration meets or exceeds the threshold.
 * A threshold of 0 disables the mark; a missing/invalid duration is never slow.
 */
export function isSlow(durationMs: number | undefined, thresholdMs: number): boolean {
  if (thresholdMs <= 0) return false;
  if (durationMs === undefined || !Number.isFinite(durationMs)) return false;
  return durationMs >= thresholdMs;
}
