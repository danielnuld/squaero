// The words of a destructive confirmation (issue #692, audit A-10, A-25, R-31):
// the title names the object, the message says what is lost and where, and the
// button says what it does with the amount («Eliminar tabla», «Eliminar 3
// filas», «Terminar sesión 4127»). Built here so every dialog says it the same
// way and the wording is unit-tested; the components only show it.

import { t } from "./i18n";
import type { DropKind } from "./dropObject";
import type { SafeMode } from "./safeMode";

export interface ConfirmText {
  title: string;
  message: string;
  /** The danger button's label: verb + object (+ amount). */
  confirm: string;
}

/** A count with its noun in the right number: `key.one` for 1, `key.other` else. */
export function countText(key: string, n: number, params: Record<string, string | number> = {}): string {
  return t(`${key}.${n === 1 ? "one" : "other"}`, { n, ...params });
}

/** What can be deleted behind a confirmation. */
export type DropWhat = DropKind | "index" | "constraint" | "user";

/**
 * Deleting a named object: «¿Eliminar la tabla clientes?» … [Eliminar tabla].
 * `where` names the connection and database it goes from, when known.
 */
export function dropConfirm(kind: DropWhat, name: string, where?: string): ConfirmText {
  return {
    title: t("confirm.drop.title", { what: t(`confirm.kind.${kind}`), name }),
    message: where ? t("confirm.drop.messageWhere", { where }) : t("confirm.drop.message"),
    confirm: t("confirm.drop.button", { what: t(`confirm.noun.${kind}`) }),
  };
}

/** Killing another session on the server (audit A-10): never without asking. */
export function killSessionConfirm(id: string, connection: string): ConfirmText {
  return {
    title: t("confirm.kill.title", { id, connection }),
    message: t("confirm.kill.message"),
    confirm: t("confirm.kill.button", { id }),
  };
}

/** Emptying the query history (audit A-10, R-31). */
export function clearHistoryConfirm(n: number): ConfirmText {
  return {
    title: t("confirm.history.title"),
    message: countText("confirm.history.message", n),
    confirm: countText("confirm.history.button", n),
  };
}

/** Dropping columns from the table designer: names every column that goes. */
export function dropColumnsConfirm(table: string, columns: readonly string[]): ConfirmText {
  const p = { table, names: columns.join(", ") };
  return {
    title: countText("confirm.dropColumns.title", columns.length, p),
    message: countText("confirm.dropColumns.message", columns.length, p),
    confirm: countText("confirm.dropColumns.button", columns.length, p),
  };
}

/** How many rows a delete confirmation lists by name; the rest are counted. */
const LISTED_ROWS = 5;

/**
 * Deleting rows from the grid (audit P1): the table, every row by its key
 * («id 2, id 4»; the first few, then «y n más») and the tables whose foreign
 * keys point at it (`dependants`, as «pedidos.cliente_id»).
 */
export function deleteRowsConfirm(
  table: string,
  rows: readonly string[],
  dependants: readonly string[] = [],
): ConfirmText {
  const n = rows.length;
  const listed = rows.slice(0, LISTED_ROWS).join(", ");
  const names = n > LISTED_ROWS ? t("confirm.deleteRows.more", { rows: listed, n: n - LISTED_ROWS }) : listed;
  const message = countText("confirm.deleteRows.message", n, { table, rows: names });
  return {
    title: countText("confirm.deleteRows.title", n, { table }),
    message:
      dependants.length > 0
        ? `${message} ${t("confirm.deleteRows.dependants", { table, refs: dependants.join(", ") })}`
        : message,
    confirm: countText("confirm.deleteRows.button", n, { table }),
  };
}

/** Revoking privileges (audit P1): who loses what, and where. */
export function revokeConfirm(who: string, privileges: readonly string[], scope: string): ConfirmText {
  return {
    title: t("confirm.revoke.title", { who }),
    message: t("confirm.revoke.message", { who, privileges: privileges.join(", "), scope }),
    confirm: countText("confirm.revoke.button", privileges.length),
  };
}

/** Resetting the server's query statistics (audit P1): every user's, for good. */
export function resetStatsConfirm(recorded: number): ConfirmText {
  return {
    title: t("confirm.resetStats.title"),
    message: countText("confirm.resetStats.message", recorded),
    confirm: t("confirm.resetStats.button"),
  };
}

/** Deleting a whole notebook (audit P1): its name and how many cells go. */
export function deleteNotebookConfirm(name: string, cells: number): ConfirmText {
  return {
    title: t("confirm.notebook.title", { name }),
    message: countText("confirm.notebook.message", cells),
    confirm: t("confirm.notebook.button"),
  };
}

/** Deleting a notebook cell that has content: its number and its first line. */
export function deleteCellConfirm(position: number, source: string): ConfirmText {
  const first = source.trim().split("\n")[0];
  const preview = first.length > 60 ? `${first.slice(0, 60)}…` : first;
  return {
    title: t("confirm.cell.title", { n: position }),
    message: t("confirm.cell.message", { preview }),
    confirm: t("confirm.cell.button"),
  };
}

/** Running a .sql file over a database (audit A-10): file, size and target. */
export function restoreConfirm(file: string, statements: number, target: string): ConfirmText {
  return {
    title: t("confirm.restore.title", { target }),
    message: countText("confirm.restore.message", statements, { file, target }),
    confirm: countText("confirm.restore.button", statements),
  };
}

/**
 * Whether a statement throws data away: one that starts with DROP or TRUNCATE,
 * an ALTER TABLE … DROP, or a mongosh `.drop()`. By its leading keyword, so a
 * DROP quoted inside the string of an INSERT does not count.
 */
export function isDestructiveSql(sql: string): boolean {
  const s = sql.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, "");
  return (
    /^(drop|truncate)\b/i.test(s) ||
    /^alter\s+table\b[^;']*\bdrop\b/i.test(s) ||
    /^db\.[\w$.]*\.drop(Database)?\s*\(/.test(s)
  );
}

/**
 * Whether the confirmation asks for the name to be typed (audit A-25, R-15):
 * on a protected connection, and only for what loses data — asking on every
 * insert would teach people to type without reading.
 */
export function needsTypedName(safeMode: SafeMode | undefined, statements: readonly string[]): boolean {
  return safeMode === "confirm" && statements.some(isDestructiveSql);
}
