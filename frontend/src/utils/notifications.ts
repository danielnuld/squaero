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

export interface Note {
  id: number;
  /** Epoch ms. */
  at: number;
  level: NoteLevel;
  text: string;
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

/** Adds a note at the top, folding an identical repeat of the newest one. */
export function pushNote(
  notes: Note[],
  note: Omit<Note, "id">,
  max: number = MAX_NOTES,
): Note[] {
  const text = note.text.trim();
  if (!text) return notes;
  const top = notes[0];
  if (top && top.text === text && top.level === note.level) {
    return [{ ...top, at: note.at }, ...notes.slice(1)];
  }
  const id = notes.reduce((m, n) => Math.max(m, n.id), 0) + 1;
  return [{ id, at: note.at, level: note.level, text }, ...notes].slice(0, Math.max(0, max));
}

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
    .slice(0, PERSIST_MAX);
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
