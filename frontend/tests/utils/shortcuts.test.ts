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
