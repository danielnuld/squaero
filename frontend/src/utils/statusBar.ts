// What the status bar says on its right-hand side (issue #693), per kind of
// tab. The left side is always the context (connection, safety, transaction);
// the right side carries facts that belong to the document on screen — a query
// tab says what ran and where the cursor is, a table tab says what it shows,
// and a tool tab or no tab says nothing rather than stale numbers.

export type StatusTabKind = "none" | "query" | "data" | "tool";

export type StatusItem =
  | "object"
  | "scope"
  | "rows"
  | "columns"
  | "marked"
  | "summary"
  | "duration"
  | "cursor";

export interface StatusFacts {
  hasObject: boolean;
  hasScope: boolean;
  rows: number | null;
  columns: number | null;
  marked: number;
  hasSummary: boolean;
  elapsedMs: number | null;
  hasCursor: boolean;
}

// The order the items read in, left to right.
const ORDER: StatusItem[] = [
  "object",
  "scope",
  "rows",
  "columns",
  "marked",
  "summary",
  "duration",
  "cursor",
];

// Which items each kind of tab may show at all.
const ALLOWED: Record<StatusTabKind, ReadonlySet<StatusItem>> = {
  none: new Set(),
  tool: new Set(),
  data: new Set(["object", "rows", "columns", "marked", "summary", "duration"]),
  query: new Set(["scope", "rows", "columns", "marked", "summary", "duration", "cursor"]),
};

/** The right-hand items to show, in order: allowed for the tab and present. */
export function statusItems(kind: StatusTabKind, f: StatusFacts): StatusItem[] {
  const present: Record<StatusItem, boolean> = {
    object: f.hasObject,
    scope: f.hasScope,
    rows: f.rows !== null,
    columns: f.columns !== null,
    marked: f.marked > 0,
    summary: f.hasSummary,
    duration: f.elapsedMs !== null,
    cursor: f.hasCursor,
  };
  return ORDER.filter((i) => ALLOWED[kind].has(i) && present[i]);
}

