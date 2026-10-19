import { describe, it, expect } from "vitest";
import {
  notesByDay,
  pushNote,
  unreadCount,
  serializeNotes,
  parseNotes,
  loadNotes,
  saveNotes,
  PERSIST_MAX,
  PERSIST_DAYS,
  NOTES_KEY,
  type Note,
} from "../../src/utils/notifications";

const DAY = 86_400_000;

describe("pushNote", () => {
  it("adds newest first with increasing ids", () => {
    let l: Note[] = [];
    l = pushNote(l, { at: 1, level: "ok", text: "a" });
    l = pushNote(l, { at: 2, level: "error", text: "b" });
    expect(l.map((n) => [n.id, n.text])).toEqual([
      [2, "b"],
      [1, "a"],
    ]);
  });

  it("folds a back-to-back repeat into the newest entry", () => {
    let l = pushNote([], { at: 1, level: "error", text: "lost" });
    l = pushNote(l, { at: 5, level: "error", text: "lost" });
    expect(l).toHaveLength(1);
    expect(l[0].at).toBe(5);
    // Same text at another level is another message.
    expect(pushNote(l, { at: 6, level: "info", text: "lost" })).toHaveLength(2);
  });

  it("caps the list and ignores blank text", () => {
    let l: Note[] = [];
    for (let i = 0; i < 5; i++) l = pushNote(l, { at: i, level: "info", text: `n${i}` }, 3);
    expect(l.map((n) => n.text)).toEqual(["n4", "n3", "n2"]);
    expect(pushNote(l, { at: 9, level: "info", text: "  " })).toBe(l);
  });
});

describe("unreadCount", () => {
  it("counts what arrived after the history was opened", () => {
    const notes = pushNote(pushNote([], { at: 10, level: "ok", text: "a" }), { at: 20, level: "ok", text: "b" });
    expect(unreadCount({ notes, seenAt: 0 })).toBe(2);
    expect(unreadCount({ notes, seenAt: 15 })).toBe(1);
    expect(unreadCount({ notes, seenAt: 20 })).toBe(0);
  });
});

describe("persistence", () => {
  it("round-trips, keeping only the newest PERSIST_MAX", () => {
    let notes: Note[] = [];
    for (let i = 0; i < PERSIST_MAX + 10; i++) notes = pushNote(notes, { at: 1000 + i, level: "info", text: `n${i}` });
    const back = parseNotes(serializeNotes({ notes, seenAt: 7 }), 2000);
    expect(back.seenAt).toBe(7);
    expect(back.notes).toHaveLength(PERSIST_MAX);
    expect(back.notes[0].text).toBe(`n${PERSIST_MAX + 9}`);
  });

  it("drops expired and malformed notes", () => {
    const now = 100 * DAY;
    const raw = JSON.stringify({
      seenAt: "x",
      notes: [
        { id: 1, at: now - DAY, level: "ok", text: "fresh" },
        { id: 2, at: now - (PERSIST_DAYS + 1) * DAY, level: "ok", text: "old" },
        { id: 3, at: now, level: "loud", text: "bad level" },
        { id: 4, at: now, level: "ok" },
        null,
      ],
    });
    const back = parseNotes(raw, now);
    expect(back.notes.map((n) => n.text)).toEqual(["fresh"]);
    expect(back.seenAt).toBe(0);
  });

  it("survives garbage, absence and a throwing store", () => {
    expect(parseNotes(null, 0)).toEqual({ notes: [], seenAt: 0 });
    expect(parseNotes("{nope", 0)).toEqual({ notes: [], seenAt: 0 });
    expect(parseNotes("42", 0)).toEqual({ notes: [], seenAt: 0 });
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadNotes(throwing, 0)).toEqual({ notes: [], seenAt: 0 });
    expect(() => saveNotes(throwing, { notes: [], seenAt: 0 })).not.toThrow();
  });

  it("saves under its own key", () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    saveNotes(store, { notes: pushNote([], { at: 5, level: "warn", text: "w" }), seenAt: 1 });
    expect(map.has(NOTES_KEY)).toBe(true);
    expect(loadNotes(store, 5).notes[0].text).toBe("w");
  });
});

describe("rich notes (M14 Notifications)", () => {
  it("keeps the title, detail and action, and an echo of the same text keeps them", () => {
    let notes = pushNote([], {
      at: 1,
      level: "error",
      text: "No se pudo conectar",
      title: "No se pudo conectar a «P»",
      detail: "timeout",
      action: { kind: "retry", connDefId: "k1" },
    });
    notes = pushNote(notes, { at: 2, level: "error", text: "No se pudo conectar" });
    expect(notes).toEqual([
      {
        id: 1,
        at: 2,
        level: "error",
        text: "No se pudo conectar",
        title: "No se pudo conectar a «P»",
        detail: "timeout",
        action: { kind: "retry", connDefId: "k1" },
      },
    ]);
  });

  it("persists a retry but not a result, which points at a tab of that session", () => {
    const now = Date.now();
    let notes = pushNote([], { at: now, level: "error", text: "a", action: { kind: "retry", connDefId: "k1" } });
    notes = pushNote(notes, { at: now, level: "ok", text: "b", title: "B", action: { kind: "result", tabId: 3 } });
    const back = parseNotes(serializeNotes({ notes, seenAt: 0 }), now);
    expect(back.notes.find((n) => n.text === "a")!.action).toEqual({ kind: "retry", connDefId: "k1" });
    expect(back.notes.find((n) => n.text === "b")).toEqual({ id: 2, at: now, level: "ok", text: "b", title: "B" });
  });

  it("drops a malformed action on load", () => {
    const raw = JSON.stringify({ seenAt: 0, notes: [{ id: 1, at: Date.now(), level: "ok", text: "x", action: { kind: "boom" } }] });
    expect(parseNotes(raw, Date.now()).notes[0].action).toBeUndefined();
  });
});

describe("notesByDay", () => {
  const at = (d: number, h: number) => new Date(2026, 9, d, h, 0, 0).getTime();
  it("groups by local day: today, yesterday, then each date, newest first", () => {
    const now = at(19, 12);
    const n = (id: number, ms: number) => ({ id, at: ms, level: "ok" as const, text: String(id) });
    const groups = notesByDay([n(1, at(17, 9)), n(2, at(18, 23)), n(3, at(19, 0)), n(4, at(19, 11))], now);
    expect(groups.map((g) => [g.day.kind, g.notes.map((x) => x.id)])).toEqual([
      ["today", [4, 3]],
      ["yesterday", [2]],
      ["date", [1]],
    ]);
    expect(groups[2].day).toEqual({ kind: "date", at: new Date(2026, 9, 17).getTime() });
  });
});
