// Which actions the result toolbar shows, and where (issue #688). The design's
// hierarchy: at most one primary action, a few frequent actions with icon and
// text on the left, the result's own tools as icons on the right, and whatever
// is rarely used collapsed into «Más». Pure, so the grouping is tested without
// a DOM; the component only draws what this returns.

export type ToolbarAction =
  | "refresh"
  | "filter"
  | "sort"
  | "search"
  | "addRow"
  | "transpose"
  | "pin"
  | "compare"
  | "chart"
  | "export"
  | "import"
  | "generate"
  | "transfer"
  | "syncSchema"
  | "syncData";

export interface ToolbarState {
  /** The result is a table or view object (a data tab or an editable query). */
  isTable: boolean;
  /** The result has columns (an empty statement result has none). */
  hasColumns: boolean;
  /** The rows can be changed (a primary key is in the result). */
  editable: boolean;
  /** The connection is protected as read-only (#666). */
  readOnly: boolean;
  /** The tab browses a whole table (its filter panel exists). */
  canFilter: boolean;
  /** Optional result tools, each present only when the workspace offers it. */
  canTranspose: boolean;
  canPin: boolean;
  canCompare: boolean;
}

export interface ToolbarLayout {
  /** Icon + text, left, in this order. */
  main: ToolbarAction[];
  /** Icon only, right of the spacer. */
  side: ToolbarAction[];
  /** Under «Más». Empty means no «Más» button at all. */
  more: ToolbarAction[];
}

/** Lays the toolbar out for one result. */
export function toolbarLayout(s: ToolbarState): ToolbarLayout {
  const main: ToolbarAction[] = ["refresh"];
  const side: ToolbarAction[] = [];
  const more: ToolbarAction[] = [];
  const writable = s.isTable && s.editable && !s.readOnly;

  // «Ordenar» opens the same panel on its sort line (R-22).
  if (s.canFilter) main.push("filter", "sort");
  if (s.hasColumns) main.push("search");
  if (writable) main.push("addRow");

  if (s.hasColumns) {
    if (s.canTranspose) side.push("transpose");
    if (s.canPin) side.push("pin");
    if (s.canCompare) side.push("compare");
    side.push("chart", "export");
  }

  if (s.isTable) {
    // Import and generate write into the table.
    if (!s.readOnly) more.push("import", "generate");
    if (s.hasColumns) more.push("transfer");
    more.push("syncSchema");
    if (s.editable && s.hasColumns) more.push("syncData");
  }
  return { main, side, more };
}
