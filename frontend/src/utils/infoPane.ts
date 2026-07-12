// Pure model for the bottom information pane (UI design proposal, phase 4).
// A desktop database tool keeps a small pane under the workspace summarizing the
// active result/object: general facts and the last operation's message. This
// module derives that display model from the tab's result state; the component
// is a thin renderer. No new data is fetched — it reuses what a run already
// produced (columns, rows, timing, the table source + PK).

import { formatDuration } from "./duration";

/** The subset of a tab's result state the info pane reads. */
export interface InfoInput {
  loading: boolean;
  error: string | null;
  columns: number;
  rows: number;
  truncated: boolean;
  elapsedMs: number | null;
  /** Source table + primary key, when the result was opened from an object. */
  source?: { table: string; db?: string; schema?: string; pk: string[] } | null;
}

export interface InfoRow {
  k: string;
  v: string;
}

/**
 * Translator injected by the component (the reactive i18n `t`), so this pure
 * module stays locale-agnostic and unit-testable — tests pass a stub that
 * resolves against a fixed locale. Mirrors the `labelOf` resolver pattern used
 * by the object tree's `flattenFiltered`.
 */
export type InfoTranslate = (key: string, params?: Record<string, string | number>) => string;

/** Key/value facts for the "General" tab. */
export function generalInfo(i: InfoInput, t: InfoTranslate): InfoRow[] {
  const rows: InfoRow[] = [];
  if (i.source) {
    const qualified = [i.source.db, i.source.schema, i.source.table]
      .filter((s): s is string => !!s && s.length > 0)
      .join(".");
    rows.push({ k: t("info.kObject"), v: qualified || i.source.table });
    rows.push({
      k: t("info.kPrimaryKey"),
      v: i.source.pk.length > 0 ? i.source.pk.join(", ") : t("info.pkReadOnly"),
    });
  }
  rows.push({ k: t("info.kRows"), v: i.rows.toLocaleString() });
  rows.push({ k: t("info.kColumns"), v: String(i.columns) });
  rows.push({ k: t("info.kTruncated"), v: i.truncated ? t("info.truncYes") : t("info.truncNo") });
  if (i.elapsedMs !== null) {
    rows.push({ k: t("info.kDuration"), v: formatDuration(i.elapsedMs) });
  }
  return rows;
}

export type MessageKind = "idle" | "loading" | "ok" | "error";

export interface InfoMessage {
  kind: MessageKind;
  text: string;
}

/** The single message shown in the "Mensajes" tab. */
export function messageInfo(i: InfoInput, t: InfoTranslate): InfoMessage {
  if (i.loading) return { kind: "loading", text: t("grid.running") };
  if (i.error) return { kind: "error", text: i.error };
  if (i.columns === 0 && i.rows === 0 && i.elapsedMs === null) {
    return { kind: "idle", text: t("info.idle") };
  }
  const dur = i.elapsedMs !== null ? t("info.inDuration", { d: formatDuration(i.elapsedMs) }) : "";
  const more = i.truncated ? t("info.moreTruncated") : "";
  return {
    kind: "ok",
    text: t("info.okText", { rows: i.rows.toLocaleString(), dur, more }),
  };
}

/** A one-line summary for the collapsed header (rows · duration · truncated). */
export function summaryLine(i: InfoInput, t: InfoTranslate): string {
  if (i.loading) return t("grid.running");
  if (i.error) return t("info.lastOpError");
  if (i.columns === 0 && i.rows === 0 && i.elapsedMs === null) return t("info.noResults");
  const parts = [t("info.rowsShort", { rows: i.rows.toLocaleString() })];
  if (i.elapsedMs !== null) parts.push(formatDuration(i.elapsedMs));
  if (i.truncated) parts.push(t("info.truncShort"));
  return parts.join(" · ");
}
