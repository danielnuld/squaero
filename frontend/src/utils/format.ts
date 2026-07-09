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
 * Normalize a boolean/bit textual form to "0" or "1" for display. Engines emit
 * booleans in many shapes — `true`/`false`, `t`/`f`, `yes`/`no`, `1`/`0`, a raw
 * 0x00/0x01 byte from MySQL `bit(1)`, or any numeric — and users expect a plain
 * 0/1 in the grid (issue: bit values not shown correctly). Unrecognized values
 * are returned verbatim so nothing is silently misrepresented.
 */
export function boolTo01(value: string): string {
  const s = value.trim().toLowerCase();
  if (s === "1" || s === "true" || s === "t" || s === "yes" || s === "y") return "1";
  if (s === "0" || s === "false" || s === "f" || s === "no" || s === "n" || s === "") return "0";
  // A raw single control byte from MySQL bit(1): 0x00 -> 0, 0x01 -> 1. Restricted
  // to control chars so printable single-digit strings ("2".."9") take the
  // numeric path below instead.
  if (value.length === 1 && value.charCodeAt(0) < 32) return value.charCodeAt(0) === 0 ? "0" : "1";
  const n = Number(value);
  if (!Number.isNaN(n)) return n !== 0 ? "1" : "0";
  return value;
}

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
  const kind = classifyType(type);
  // Booleans/bits always render as 0/1 (issue: bit values not shown correctly).
  return { text: kind === "bool" ? boolTo01(value) : value, kind };
}

/** Numeric kinds are right-aligned; everything else left-aligned. */
export function cellAlign(kind: CellKind): "left" | "right" {
  return kind === "number" ? "right" : "left";
}
