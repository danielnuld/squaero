// What the status bar says about the active result (issue #386).
//
// This replaces the bottom information pane, which spent a whole band — plus a
// second one for the pager — on four facts that fit in the bar the window
// already has. The only thing in it that was not already a status-bar item is
// the name of the object the rows came from, and that is this module.

/** Source table + primary key, as a run records it when opened from an object. */
export interface ResultSource {
  table: string;
  db?: string;
  schema?: string;
  pk: string[];
}

/**
 * The object's display name: `db.schema.table`, skipping the parts an engine
 * does not have. For reading, not for querying — it is deliberately unquoted,
 * unlike `qualifiedName()` in schema.ts, which builds SQL.
 */
export function sourceLabel(source: ResultSource | null | undefined): string | null {
  if (!source) return null;
  const qualified = [source.db, source.schema, source.table]
    .filter((p): p is string => !!p && p.length > 0)
    .join(".");
  return qualified || source.table || null;
}
