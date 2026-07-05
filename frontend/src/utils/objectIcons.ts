// Single source of truth for object-type badges (issue #185). Every place that
// labels a database object — the schema tree, the routine/trigger explorers, and
// any future tool tab — MUST derive its badge from here so the iconography stays
// consistent across the whole UI. Badges are short uppercase text codes (no
// symbol/text mix) rendered as a coloured chip via the `.objtree-badge.kind-*`
// classes. Pure and fully testable.

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
  | "event";

/** How to render a badge: the text shown in the chip and its CSS colour class. */
export interface ObjectBadge {
  /** Short uppercase code shown in the chip. */
  text: string;
  /** CSS class carrying the chip colour (paired with `.objtree-badge`). */
  className: string;
}

const BADGES: Record<ObjectKind, ObjectBadge> = {
  database: { text: "DB", className: "kind-database" },
  schema: { text: "SCH", className: "kind-schema" },
  table: { text: "TBL", className: "kind-table" },
  view: { text: "VW", className: "kind-view" },
  procedure: { text: "PROC", className: "kind-routine" },
  function: { text: "FN", className: "kind-routine" },
  routine: { text: "PROC", className: "kind-routine" },
  trigger: { text: "TRG", className: "kind-trigger" },
  event: { text: "EVT", className: "kind-event" },
};

/** The badge for a canonical object kind. Unknown kinds fall back to a neutral
    chip so a new/unmapped kind never crashes the render. */
export function objectBadge(kind: string): ObjectBadge {
  return BADGES[kind as ObjectKind] ?? { text: "?", className: "kind-unknown" };
}

/** Resolve a routine's canonical kind from its engine type string. The catalogs
    report the type as PROCEDURE / FUNCTION (MySQL ROUTINE_TYPE, Informix, …);
    anything containing FUNCTION is a function, everything else a procedure. */
export function routineKind(type: string | null | undefined): "procedure" | "function" {
  return (type ?? "").toUpperCase().includes("FUNCTION") ? "function" : "procedure";
}
