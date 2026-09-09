// Persistence adapter for the per-type grid colours (issue #483). Mirrors
// settingsStore / tabsStore: the pure helpers in cellColors.ts paired with the
// shared kvStore (localStorage, or memory where that is blocked).

import {
  CELL_COLORS_KEY,
  parseCellColors,
  serializeCellColors,
  type CellColorStore,
} from "./cellColors";
import { resolveStore } from "./kvStore";

const store = resolveStore();

/** The saved overrides, or an empty set. Never throws. */
export function loadCellColors(): CellColorStore {
  try {
    return parseCellColors(store.getItem(CELL_COLORS_KEY));
  } catch {
    return {};
  }
}

/** Persists the overrides. Silent on storage failure — the colours still apply
    for this session, and a blocked store must not break the panel. */
export function saveCellColors(colors: CellColorStore): void {
  try {
    store.setItem(CELL_COLORS_KEY, serializeCellColors(colors));
  } catch {
    /* best-effort, like every other store here */
  }
}
