import { describe, it, expect } from "vitest";
import {
  matchShortcut,
  displayKeys,
  SHORTCUTS,
  type KeyEventLike,
} from "../../src/utils/shortcuts";

const ev = (over: Partial<KeyEventLike>): KeyEventLike => ({
  key: "",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("matchShortcut — global actions", () => {
  it("Ctrl+Alt+T / W / L map to tab + theme actions", () => {
    expect(matchShortcut(ev({ key: "t", ctrlKey: true, altKey: true }))).toBe("new-tab");
    expect(matchShortcut(ev({ key: "w", ctrlKey: true, altKey: true }))).toBe("close-tab");
    expect(matchShortcut(ev({ key: "l", ctrlKey: true, altKey: true }))).toBe("toggle-theme");
  });
  it("accepts Cmd (meta) as Mod on macOS", () => {
    expect(matchShortcut(ev({ key: "t", metaKey: true, altKey: true }))).toBe("new-tab");
  });
  it("Ctrl+PageUp/Down cycle tabs", () => {
    expect(matchShortcut(ev({ key: "PageDown", ctrlKey: true }))).toBe("next-tab");
    expect(matchShortcut(ev({ key: "PageUp", ctrlKey: true }))).toBe("prev-tab");
  });
  it("F5 refreshes", () => {
    expect(matchShortcut(ev({ key: "F5" }))).toBe("refresh");
  });
  it("F1 toggles help", () => {
    expect(matchShortcut(ev({ key: "F1" }))).toBe("toggle-help");
  });
  it("Ctrl/Cmd+K opens the command palette", () => {
    expect(matchShortcut(ev({ key: "k", ctrlKey: true }))).toBe("command-palette");
    expect(matchShortcut(ev({ key: "K", metaKey: true }))).toBe("command-palette");
    // must not fire with Alt/Shift held (avoids clobbering editor combos)
    expect(matchShortcut(ev({ key: "k", ctrlKey: true, altKey: true }))).toBeNull();
  });
  it("Ctrl/Cmd+P opens the object palette", () => {
    expect(matchShortcut(ev({ key: "p", ctrlKey: true }))).toBe("object-palette");
    expect(matchShortcut(ev({ key: "P", metaKey: true }))).toBe("object-palette");
  });
  it("Ctrl/Cmd+F opens the editor find", () => {
    expect(matchShortcut(ev({ key: "f", ctrlKey: true }))).toBe("editor-find");
    expect(matchShortcut(ev({ key: "F", metaKey: true }))).toBe("editor-find");
  });
  it("Ctrl/Cmd+Shift+F stays the editor formatter, not global find", () => {
    // format-sql is editor-owned (global:false) and must not match here.
    expect(matchShortcut(ev({ key: "f", ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});

describe("matchShortcut — non-matches", () => {
  it("does NOT match run-query globally (editor owns Mod+Enter)", () => {
    expect(matchShortcut(ev({ key: "Enter", ctrlKey: true }))).toBeNull();
  });
  it("ignores plain letters and unmodified typing", () => {
    expect(matchShortcut(ev({ key: "t" }))).toBeNull();
    expect(matchShortcut(ev({ key: "t", ctrlKey: true }))).toBeNull(); // needs Alt too
  });
});

describe("displayKeys", () => {
  it("renders Mod as Ctrl or ⌘", () => {
    expect(displayKeys("Mod+Alt+T", false)).toBe("Ctrl+Alt+T");
    expect(displayKeys("Mod+Enter", true)).toBe("⌘+Enter");
  });
});

describe("SHORTCUTS table", () => {
  it("documents every action id once", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("run-query is present but not globally matched", () => {
    const run = SHORTCUTS.find((s) => s.id === "run-query");
    expect(run?.global).toBe(false);
  });
});
