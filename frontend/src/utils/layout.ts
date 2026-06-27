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
