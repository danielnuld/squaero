// Notification history (issue #693, audit R-30). A toast says something once
// and leaves; the bell keeps what was said so a message that left before it was
// read is not lost. Pure list management plus the persistence policy:
//
// - newest first, capped at MAX_NOTES in memory;
// - the same message repeated back to back is one entry, refreshed (a retry
//   loop must not flood the list);
// - persisted: only the newest PERSIST_MAX, and anything older than
//   PERSIST_DAYS is dropped on load. The texts are what the toasts said — the
//   same local storage that already keeps the query history.

import type { KeyValueStore } from "./kvStore";

export type NoteLevel = "info" | "ok" | "warn" | "error";

/**
 * What a note offers to do (M14 Notifications): try the connection again, or
 * show the result of a tab that finished while another was in front. Only
 * actions the app can honestly carry out — there is no «Mostrar en la carpeta»
 * because the shell has no way to reveal a file.
 */
export type NoteAction =
  | { kind: "retry"; connDefId: string }
  | { kind: "result"; tabId: number };

export interface Note {
  id: number;
  /** Epoch ms. */
  at: number;
  level: NoteLevel;
  /** What the toast said; the line shown when there is no title. */
  text: string;
  /** A short headline («No se pudo conectar a «Producción»»), with `detail` under it. */
  title?: string;
  detail?: string;
  action?: NoteAction;
}

export interface NoteLog {
  notes: Note[];
  /** Notes after this instant (epoch ms) are unread. */
  seenAt: number;
}

export const MAX_NOTES = 100;
export const PERSIST_MAX = 50;
export const PERSIST_DAYS = 7;
export const NOTES_KEY = "quaero.notifications";

const LEVELS: readonly NoteLevel[] = ["info", "ok", "warn", "error"];
const DAY_MS = 86_400_000;

/**
 * Adds a note at the top, folding an identical repeat of the newest one (same
 * text and level). A repeat keeps the title, detail and action it already had
 * unless it brings its own: the toast that echoes a richer note adds nothing.
 */
export function pushNote(
  notes: Note[],
  note: Omit<Note, "id">,
  max: number = MAX_NOTES,
): Note[] {
  const text = note.text.trim();
  if (!text) return notes;
  const extra: Partial<Note> = {};
  if (note.title) extra.title = note.title;
  if (note.detail) extra.detail = note.detail;
  if (note.action) extra.action = note.action;
  const top = notes[0];
  if (top && top.text === text && top.level === note.level) {
    return [{ ...top, ...extra, at: note.at }, ...notes.slice(1)];
  }
  const id = notes.reduce((m, n) => Math.max(m, n.id), 0) + 1;
  return [{ id, at: note.at, level: note.level, text, ...extra }, ...notes].slice(0, Math.max(0, max));
}

/** The day a note belongs to, as the panel groups them: today, yesterday, or its date. */
export type NoteDay = { kind: "today" } | { kind: "yesterday" } | { kind: "date"; at: number };

/**
 * The notes split by day (M14 Notifications: «Hoy», «Ayer», then each date),
 * newest first, in the LOCAL calendar — a note from 00:30 is today's even when
 * it is less than an hour after one from yesterday.
 */
export function notesByDay(notes: readonly Note[], now: number): { day: NoteDay; notes: Note[] }[] {
  const startOf = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const today = startOf(now);
  const yesterday = startOf(today - 1);
  const out: { day: NoteDay; key: number; notes: Note[] }[] = [];
  for (const n of [...notes].sort((a, b) => b.at - a.at)) {
    const key = startOf(n.at);
    const last = out[out.length - 1];
    if (last && last.key === key) {
      last.notes.push(n);
      continue;
    }
    const day: NoteDay =
      key >= today ? { kind: "today" } : key === yesterday ? { kind: "yesterday" } : { kind: "date", at: key };
    out.push({ day, key, notes: [n] });
  }
  return out.map(({ day, notes: list }) => ({ day, notes: list }));
}

const isAction = (a: unknown): a is NoteAction => {
  const x = a as NoteAction;
  return (
    !!x &&
    typeof x === "object" &&
    ((x.kind === "retry" && typeof x.connDefId === "string") ||
      (x.kind === "result" && Number.isFinite(x.tabId)))
  );
};

/** How many notes arrived after the history was last opened. */
export function unreadCount(log: NoteLog): number {
  return log.notes.filter((n) => n.at > log.seenAt).length;
}

/** The persisted form: the newest PERSIST_MAX notes. */
export function serializeNotes(log: NoteLog): string {
  return JSON.stringify({ seenAt: log.seenAt, notes: log.notes.slice(0, PERSIST_MAX) });
}

/** Reads a persisted log, dropping malformed and expired notes. Never throws. */
export function parseNotes(raw: string | null, now: number): NoteLog {
  const empty: NoteLog = { notes: [], seenAt: 0 };
  if (!raw) return empty;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!data || typeof data !== "object") return empty;
  const d = data as { seenAt?: unknown; notes?: unknown };
  const oldest = now - PERSIST_DAYS * DAY_MS;
  const notes = (Array.isArray(d.notes) ? d.notes : [])
    .filter(
      (n): n is Note =>
        !!n &&
        typeof n === "object" &&
        Number.isFinite((n as Note).id) &&
        Number.isFinite((n as Note).at) &&
        LEVELS.includes((n as Note).level) &&
        typeof (n as Note).text === "string",
    )
    .filter((n) => n.at >= oldest)
    .slice(0, PERSIST_MAX)
    .map((n) => {
      // Only the shape the panel reads; a «Ver resultado» points at a tab of
      // the session that wrote it, which a restart does not bring back.
      const out: Note = { id: n.id, at: n.at, level: n.level, text: n.text };
      if (typeof n.title === "string") out.title = n.title;
      if (typeof n.detail === "string") out.detail = n.detail;
      if (isAction(n.action) && n.action.kind === "retry") out.action = n.action;
      return out;
    });
  return { notes, seenAt: Number.isFinite(d.seenAt) ? (d.seenAt as number) : 0 };
}

export function loadNotes(store: Pick<KeyValueStore, "getItem">, now: number): NoteLog {
  try {
    return parseNotes(store.getItem(NOTES_KEY), now);
  } catch {
    return { notes: [], seenAt: 0 };
  }
}

/** Best-effort: a full or blocked store must not break the UI. */
export function saveNotes(store: Pick<KeyValueStore, "setItem">, log: NoteLog): void {
  try {
    store.setItem(NOTES_KEY, serializeNotes(log));
  } catch {
    /* best-effort */
  }
}
