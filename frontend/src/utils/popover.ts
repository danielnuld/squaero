// Where a floating box goes next to the element that owns it (issue #687).
//
// Tooltips and dropdown lists share one rule: open below the anchor, flip above
// when the bottom of the window is in the way, and slide sideways so the box
// never leaves the viewport. Pure — the caller measures both rectangles.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlaceInput {
  anchor: Rect;
  /** The box to place, already measured. */
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Space kept between the anchor and the box (default 4px). */
  gap?: number;
  /** Space kept from the window edges (default 4px). */
  margin?: number;
  /** "start" lines the box up with the anchor's left edge; "center" centres it. */
  align?: "start" | "center";
}

export interface Placement {
  x: number;
  y: number;
  /** True when the box had to flip above the anchor. */
  above: boolean;
}

/**
 * Places a box relative to its anchor. Below by default; above when it would
 * overflow the bottom AND there is more room above; horizontally aligned to the
 * anchor and then clamped so it stays inside the window.
 */
export function placeBelow(i: PlaceInput): Placement {
  const gap = i.gap ?? 4;
  const margin = i.margin ?? 4;
  const a = i.anchor;
  const roomBelow = i.viewport.height - (a.top + a.height) - gap - margin;
  const roomAbove = a.top - gap - margin;
  const above = i.size.height > roomBelow && roomAbove > roomBelow;
  const rawY = above ? a.top - gap - i.size.height : a.top + a.height + gap;
  const rawX =
    i.align === "center" ? a.left + a.width / 2 - i.size.width / 2 : a.left;
  return {
    x: Math.max(margin, Math.min(rawX, i.viewport.width - i.size.width - margin)),
    y: Math.max(margin, Math.min(rawY, i.viewport.height - i.size.height - margin)),
    above,
  };
}
