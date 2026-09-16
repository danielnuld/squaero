// What a grid cell SHOWS, which in the "informe" style is not what it holds
// (issue #540).
//
// The rule that governs everything here: this changes the pixels and nothing
// else. Copying, filtering, exporting, generating INSERTs and editing all read
// `res.rows`, the raw string the core sent, and none of them come through this
// module. A formatted value that reached the clipboard — "1,250.00" pasted into
// a WHERE clause — would be a data bug wearing a typography costume.
//
// Pure: takes a translator for the month names rather than reaching for the
// locale, the same way validateConnection does.

import { classifyType, formatCell, type FormattedCell } from "./format";
import type { GridStyle } from "./settings";

/**
 * Groups thousands in the integer part, working ON THE STRING.
 *
 * Never goes through Number: the core sends decimals and bigints as text
 * precisely because they do not survive a float. `Number("9007199254740993")`
 * is 9007199254740992, and a balance that changes when you look at it is worse
 * than one that is hard to read.
 *
 * Anything that is not a plain decimal — scientific notation, hex, Infinity,
 * an engine's own spelling — is returned untouched rather than guessed at.
 */
export function groupThousands(value: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!m) return value;
  const [, sign, whole, fraction = ""] = m;
  // Grouped from four digits up, as the prototype shows ("1,250.00"). A year in
  // a numeric column becomes "2,024", and there is no way to tell it from a
  // quantity BY ITS LENGTH — the honest fix is per column (ids and keys), which
  // needs the column metadata the grid has and this module does not. Tracked as
  // an open question on the change.
  return sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + fraction;
}

/** Month names, as i18n keys. The catalogs carry the abbreviations. */
const MONTH_KEYS = [
  "month.1", "month.2", "month.3", "month.4", "month.5", "month.6",
  "month.7", "month.8", "month.9", "month.10", "month.11", "month.12",
];

/**
 * Rewrites a leading ISO date as "14 feb 2023", keeping whatever follows (a
 * time, a zone) exactly as it came.
 *
 * Only touches a value that STARTS with YYYY-MM-DD. Informix can hand back
 * dates shaped by DBDATE, and a value this does not recognise is shown as it
 * is — better an unformatted date than a wrong one.
 */
export function humanDate(value: string, t: (key: string) => string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
  if (!m) return value;
  const [, year, month, day, rest] = m;
  const index = Number(month) - 1;
  if (index < 0 || index > 11) return value;
  return `${Number(day)} ${t(MONTH_KEYS[index])} ${year}${rest}`;
}

/**
 * The text a cell shows, for a style.
 *
 * Outside "informe" — and for NULL in every style — this is exactly
 * `formatCell`, so the other two styles cannot drift from the shared formatting
 * by accident.
 */
export function displayText(
  value: string | null,
  type: string,
  style: GridStyle,
  t: (key: string) => string,
): FormattedCell {
  const base = formatCell(value, type);
  if (style !== "informe" || value === null) return base;

  const kind = classifyType(type);
  if (kind === "number") return { ...base, text: groupThousands(base.text) };
  if (kind === "temporal") return { ...base, text: humanDate(base.text, t) };
  return base;
}
