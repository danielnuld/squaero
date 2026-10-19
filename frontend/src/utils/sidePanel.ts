// The side column and the rail that switches it (issues #688, #689). The rail
// picks what the column shows — the object explorer, the history, the snippets
// or the data search — and clicking the item already shown folds the column
// away, the way desktop editors do. Which one and whether it is folded are
// remembered with the rest of the layout; the width lives in paneSizes.

import { resolveStore } from "./kvStore";

export type SidePanel = "explorer" | "history" | "snippets" | "search";

export interface SideState {
  panel: SidePanel;
  collapsed: boolean;
}

export const SIDE_PANELS: readonly SidePanel[] = ["explorer", "history", "snippets", "search"];

export const DEFAULT_SIDE: SideState = { panel: "explorer", collapsed: false };

const STORAGE_KEY = "quaero.sidePanel";

/** Parses the stored state; anything unusable falls back to the default. */
export function parseSideState(raw: string | null): SideState {
  if (!raw) return DEFAULT_SIDE;
  try {
    const data = JSON.parse(raw) as Partial<SideState> | null;
    if (!data || typeof data !== "object") return DEFAULT_SIDE;
    return {
      panel: SIDE_PANELS.includes(data.panel as SidePanel) ? (data.panel as SidePanel) : "explorer",
      collapsed: data.collapsed === true,
    };
  } catch {
    return DEFAULT_SIDE;
  }
}

/**
 * What a click on a rail item does: another panel is shown (and the column
 * unfolded); the panel already shown folds the column, or unfolds it again.
 */
export function railClick(state: SideState, panel: SidePanel): SideState {
  if (state.panel === panel) return { panel, collapsed: !state.collapsed };
  return { panel, collapsed: false };
}

const store = resolveStore();

export function loadSideState(): SideState {
  try {
    return parseSideState(store.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SIDE;
  }
}

export function saveSideState(state: SideState): void {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* best-effort, like every other pref */
  }
}
