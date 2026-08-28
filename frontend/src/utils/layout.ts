// Pure helpers for the resizable layout. The sidebar width is dragged by the
// user; these clamp it to a sane band so it can neither vanish nor swallow the
// workspace. Kept separate from the component so the bounds logic is testable.

export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 640;
export const SIDEBAR_DEFAULT = 260;

/** Clamps a proposed sidebar width to [min, max]. */
export function clampSidebarWidth(
  width: number,
  min = SIDEBAR_MIN,
  max = SIDEBAR_MAX,
): number {
  if (Number.isNaN(width)) {
    return min;
  }
  return Math.max(min, Math.min(width, max));
}

// The editor's share of a query tab's height, in percent (issue #423). It used
// to be a fixed 40%: opening a procedure's definition showed 18 of its lines
// while the other 60% held an empty grid that had nothing to show yet. The
// split is dragged now, and dragging it all the way down (100) leaves the whole
// window to the editor — the result pane collapses to nothing and comes back on
// the next drag or a double click on the divider.
export const EDITOR_PCT_MIN = 15;
export const EDITOR_PCT_MAX = 100;
export const EDITOR_PCT_DEFAULT = 40;

/** Clamps a proposed editor share to [min, max]. */
export function clampEditorPct(
  pct: number,
  min = EDITOR_PCT_MIN,
  max = EDITOR_PCT_MAX,
): number {
  if (Number.isNaN(pct)) {
    return EDITOR_PCT_DEFAULT;
  }
  return Math.max(min, Math.min(pct, max));
}
