// Keyboard navigation over a vertical list of items (issue #687): the arrow,
// Home/End and type-ahead rules the dropdown and the context menu share, as
// pure index arithmetic. Nothing here touches the DOM.

/** Keys `stepIndex` understands; anything else returns the current index. */
export type StepKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "PageDown" | "PageUp";

const PAGE = 10;

/**
 * The index reached from `current` by pressing `key` over `count` items,
 * skipping disabled ones. Arrows wrap around; Home/End jump to the first/last
 * enabled item; Page keys move ten rows and stop at the ends. A `current` of -1
 * (nothing active) makes ArrowDown land on the first item and ArrowUp on the
 * last. Returns -1 when nothing is enabled.
 */
export function stepIndex(
  count: number,
  current: number,
  key: string,
  isDisabled: (i: number) => boolean = () => false,
): number {
  if (count <= 0) return -1;
  const enabled = (i: number) => i >= 0 && i < count && !isDisabled(i);
  const scan = (from: number, dir: 1 | -1, wrap: boolean): number => {
    for (let n = 0, i = from; n < count; n++, i += dir) {
      if (wrap) i = (i + count) % count;
      else if (i < 0 || i >= count) break;
      if (enabled(i)) return i;
    }
    return enabled(current) ? current : -1;
  };
  switch (key as StepKey) {
    case "ArrowDown":
      return scan(current + 1, 1, true);
    case "ArrowUp":
      return scan(current < 0 ? count - 1 : current - 1, -1, true);
    case "Home":
      return scan(0, 1, false);
    case "End":
      return scan(count - 1, -1, false);
    case "PageDown":
      return scan(Math.min(count - 1, Math.max(current, 0) + PAGE), -1, false);
    case "PageUp":
      return scan(Math.max(0, current - PAGE), 1, false);
    default:
      return current;
  }
}

/**
 * Type-ahead: the item whose label starts with what was typed. Repeating one
 * letter cycles through the items starting with it; a longer prefix finds the
 * first match after `current`, wrapping. Case-insensitive. -1 when none.
 */
export function typeAhead(
  labels: readonly string[],
  current: number,
  typed: string,
  isDisabled: (i: number) => boolean = () => false,
): number {
  if (!typed || labels.length === 0) return -1;
  const q = typed.toLowerCase();
  const cycling = q.length > 1 && q.split("").every((c) => c === q[0]);
  const needle = cycling ? q[0] : q;
  // A single (or repeated) letter moves on from the current item; a growing
  // prefix keeps refining the match from the current one.
  const start = cycling || q.length === 1 ? current + 1 : Math.max(current, 0);
  for (let n = 0; n < labels.length; n++) {
    const i = (start + n + labels.length) % labels.length;
    if (!isDisabled(i) && labels[i].toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}

/** True for the keys that open a context menu from the keyboard. */
export function isContextMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
}
