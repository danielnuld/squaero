// Single source of truth for object-type badges (issue #185). Every place that
// labels a database object — the schema tree, the routine/trigger explorers, and
// any future tool tab — MUST derive its badge from here so the iconography stays
// consistent across the whole UI. A badge is an icon of the set (#683) coloured
// with its `--obj-*` token via the `.objtree-badge.kind-*` classes; render it with
// <ObjectIcon kind=… />. Pure and fully testable.

import type { IconName } from "../components/icons";

/** A canonical object kind. `routine` is a defensive fallback for a combined
    proc+func leaf of unknown subtype; callers that know the subtype resolve it
    through `routineKind()` first and pass `procedure`/`function`. */
export type ObjectKind =
  | "database"
  | "schema"
  | "table"
  | "view"
  | "procedure"
  | "function"
  | "routine"
  | "trigger"
  | "event"
  // A table's own levels (audit A-16).
  | "column"
  | "key"
  | "fk"
  | "index";

/** How to render a badge: its icon and its CSS colour class. */
export interface ObjectBadge {
  /** The icon of the set drawn for this kind. */
  icon: IconName;
  /** CSS class carrying the icon colour (paired with `.objtree-badge`). */
  className: string;
}

const BADGES: Record<ObjectKind, ObjectBadge> = {
  database: { icon: "database", className: "kind-database" },
  schema: { icon: "schema", className: "kind-schema" },
  table: { icon: "table", className: "kind-table" },
  view: { icon: "view", className: "kind-view" },
  procedure: { icon: "procedure", className: "kind-procedure" },
  function: { icon: "function", className: "kind-function" },
  routine: { icon: "procedure", className: "kind-procedure" },
  trigger: { icon: "trigger", className: "kind-trigger" },
  event: { icon: "event", className: "kind-event" },
  column: { icon: "column", className: "kind-column" },
  key: { icon: "key", className: "kind-key" },
  fk: { icon: "fk", className: "kind-fk" },
  index: { icon: "sort", className: "kind-index" },
};

/** The badge for a canonical object kind. Unknown kinds fall back to a neutral
    mark so a new/unmapped kind never crashes the render. */
export function objectBadge(kind: string): ObjectBadge {
  return BADGES[kind as ObjectKind] ?? { icon: "help", className: "kind-unknown" };
}

/** Resolve a routine's canonical kind from its engine type string. The catalogs
    report the type as PROCEDURE / FUNCTION (MySQL ROUTINE_TYPE, Informix, …);
    anything containing FUNCTION is a function, everything else a procedure. */
export function routineKind(type: string | null | undefined): "procedure" | "function" {
  return (type ?? "").toUpperCase().includes("FUNCTION") ? "function" : "procedure";
}
