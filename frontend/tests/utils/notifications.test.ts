import { describe, it, expect } from "vitest";
import {
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
