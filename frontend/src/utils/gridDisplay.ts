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
import type { GridStyle, NumberFormat } from "./settings";

/**
 * A plain decimal written the regional way (R-13): thousands grouped and the
 * decimal mark of `locale` ("1250.00" → "1.250,00" in es, "1,250.00" in en).
 * On the string, like groupThousands, so nothing loses precision; anything
 * that is not a plain decimal is returned untouched.
 */
export function regionalNumber(value: string, locale: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) return value;
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((p) => p.type === "group")?.value ?? ",";
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const [, sign, whole, fraction] = m;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return sign + grouped + (fraction !== undefined ? decimal + fraction : "");
}

/** How the grid writes values beyond its style: numbers and NULL. */
export interface DisplayOptions {
  numbers?: NumberFormat;
  /** The interface's language, for the regional format. */
  locale?: string;
  /** What a NULL reads as (Ajustes › Rejilla); "NULL" when absent. */
  nullText?: string;
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
 * Outside "informe" this is `formatCell`, so the styles cannot drift from the
 * shared formatting by accident; the exceptions are a boolean, shown as
 * `true`/`false`, NULL's chosen text, and numbers when `opts.numbers` is
 * "regional". No style groups thousands on its own (rule 6): values are raw.
 */
export function displayText(
  value: string | null,
  type: string,
  style: GridStyle,
  t: (key: string) => string,
  opts: DisplayOptions = {},
): FormattedCell {
  const base = formatCell(value, type);
  if (value === null) return opts.nullText ? { ...base, text: opts.nullText } : base;
  const kind = classifyType(type);
  // A boolean shows as the literal it means, never as 0/1 nor yes/no (issue
  // #690: raw values). formatCell has already folded every engine's spelling to
  // 0/1; anything it could not fold is shown as it came.
  if (kind === "bool") return { ...base, text: base.text === "1" ? "true" : base.text === "0" ? "false" : base.text };
  if (kind === "number" && opts.numbers === "regional") {
    return { ...base, text: regionalNumber(base.text, opts.locale ?? "es") };
  }
  if (style === "informe" && kind === "temporal") return { ...base, text: humanDate(base.text, t) };
  return base;
}
