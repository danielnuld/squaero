// Pure helpers for the document tab strip (issue #688): which icon a tab shows
// and which tabs the strip cannot fit. The component measures; these decide.

import type { Tab } from "./tabs";

/** The icon a document tab shows, as a name from the app's icon set. */
export type TabIconName =
  | "query"
  | "table"
  | "tools"
  | "settings"
  | "history"
  | "bookmark"
  | "plug"
  | "help";

const TOOL_ICONS: Partial<Record<string, TabIconName>> = {
  settings: "settings",
  history: "history",
  localHistory: "history",
  snippets: "bookmark",
  connections: "plug",
  connectionForm: "plug",
  help: "help",
};

/**
 * The type icon of a tab: a table's rows (a data tab) show the table icon, any
 * other query tab the query icon, and a tool its own icon or the generic one.
 */
export function tabIcon(tab: Pick<Tab, "kind"> & { tool?: string }, isData: boolean): TabIconName {
  if (tab.kind === "tool") return TOOL_ICONS[tab.tool ?? ""] ?? "tools";
  return isData ? "table" : "query";
}

/** A tab's horizontal extent, in the same coordinates as the strip's. */
export interface Span {
  left: number;
  right: number;
}

/**
 * Indices of the tabs that are not fully inside the strip's visible window —
 * what the overflow menu lists. A tab cut by either edge counts as hidden: a
 * half-shown title is no easier to find than a hidden one. A window with no
 * width (not laid out yet) hides nothing rather than everything.
 */
export function hiddenTabs(tabs: readonly Span[], view: Span): number[] {
  if (view.right <= view.left) return [];
  const out: number[] = [];
  tabs.forEach((s, i) => {
    // Half a pixel of slack: zoomed layouts land on fractional edges.
    if (s.left < view.left - 0.5 || s.right > view.right + 0.5) out.push(i);
  });
  return out;
}
