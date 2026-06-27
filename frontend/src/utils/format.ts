// Cell formatting driven by the column's neutral type. The core sends every
// cell as a string (its textual form) or null for a SQL NULL; the UI formats
// from metadata and never infers from the value (see .rules/frontend.md §3).
// Neutral type names mirror ipc_type_name in the core: int, float, bool, text,
// blob, date, time, timestamp, json, null.

/** Broad visual class for a cell, used to pick alignment and styling. */
export type CellKind = "null" | "number" | "bool" | "text" | "blob" | "temporal";

export interface FormattedCell {
  /** Text to display in the cell. */
  text: string;
  /** Visual class for styling/alignment. */
  kind: CellKind;
}

/** Maps a neutral column type to its visual class. Unknown types render as text. */
export function classifyType(type: string): CellKind {
  switch (type.toLowerCase()) {
    case "int":
    case "float":
      return "number";
    case "bool":
      return "bool";
    case "blob":
      return "blob";
    case "date":
    case "time":
    case "timestamp":
      return "temporal";
    case "null":
    case "text":
    case "json":
    default:
      return "text";
  }
}

/** Display label shown for a SQL NULL. */
export const NULL_LABEL = "NULL";

/**
 * Formats one cell. A SQL NULL (value === null) always renders as the NULL
 * label with the "null" kind, regardless of the column type. Otherwise the
 * value is shown verbatim (the core already produced its textual form) and the
 * kind comes from the column type.
 */
export function formatCell(value: string | null, type: string): FormattedCell {
  if (value === null) {
    return { text: NULL_LABEL, kind: "null" };
  }
  return { text: value, kind: classifyType(type) };
}

/** Numeric kinds are right-aligned; everything else left-aligned. */
export function cellAlign(kind: CellKind): "left" | "right" {
  return kind === "number" ? "right" : "left";
}
