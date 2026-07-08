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

/** Key/value facts for the "General" tab. */
export function generalInfo(i: InfoInput): InfoRow[] {
  const rows: InfoRow[] = [];
  if (i.source) {
    const qualified = [i.source.db, i.source.schema, i.source.table]
      .filter((s): s is string => !!s && s.length > 0)
      .join(".");
    rows.push({ k: "Objeto", v: qualified || i.source.table });
    rows.push({
      k: "Clave primaria",
      v: i.source.pk.length > 0 ? i.source.pk.join(", ") : "— (solo lectura)",
    });
  }
  rows.push({ k: "Filas", v: i.rows.toLocaleString() });
  rows.push({ k: "Columnas", v: String(i.columns) });
  rows.push({ k: "Truncado", v: i.truncated ? "sí (hay más páginas)" : "no" });
  if (i.elapsedMs !== null) {
    rows.push({ k: "Duración", v: formatDuration(i.elapsedMs) });
  }
  return rows;
}

export type MessageKind = "idle" | "loading" | "ok" | "error";

export interface InfoMessage {
  kind: MessageKind;
  text: string;
}

/** The single message shown in the "Mensajes" tab. */
export function messageInfo(i: InfoInput): InfoMessage {
  if (i.loading) return { kind: "loading", text: "Ejecutando…" };
  if (i.error) return { kind: "error", text: i.error };
  if (i.columns === 0 && i.rows === 0 && i.elapsedMs === null) {
    return { kind: "idle", text: "Sin resultados todavía." };
  }
  const dur = i.elapsedMs !== null ? ` en ${formatDuration(i.elapsedMs)}` : "";
  const more = i.truncated ? " (truncado — hay más páginas)" : "";
  return {
    kind: "ok",
    text: `Correcto: ${i.rows.toLocaleString()} fila(s)${dur}${more}.`,
  };
}

/** A one-line summary for the collapsed header (rows · duration · truncated). */
export function summaryLine(i: InfoInput): string {
  if (i.loading) return "Ejecutando…";
  if (i.error) return "Error en la última operación";
  if (i.columns === 0 && i.rows === 0 && i.elapsedMs === null) return "Sin resultados";
  const parts = [`${i.rows.toLocaleString()} fila(s)`];
  if (i.elapsedMs !== null) parts.push(formatDuration(i.elapsedMs));
  if (i.truncated) parts.push("truncado");
  return parts.join(" · ");
}
