import { describe, it, expect } from "vitest";
import {
  matchShortcut,
  formatKeys,
  keysOf,
  migrateOverrides,
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
  it("Ctrl/Cmd+T / W open and close a tab, as in a browser (#591)", () => {
    expect(matchShortcut(ev({ key: "t", ctrlKey: true }))).toBe("new-tab");
    expect(matchShortcut(ev({ key: "w", ctrlKey: true }))).toBe("close-tab");
    expect(matchShortcut(ev({ key: "T", metaKey: true }))).toBe("new-tab");
    expect(matchShortcut(ev({ key: "W", metaKey: true }))).toBe("close-tab");
  });
  // R-17: Ctrl+Alt is AltGr on many keyboards (AltGr+C types «ć»), and
  // Ctrl+Alt+L locks the screen on Linux. No default uses it any more.
  it("binds nothing to Ctrl+Alt: the old tab, theme and transaction keys are free", () => {
    for (const key of ["t", "w", "l", "c", "r"]) {
      expect(matchShortcut(ev({ key, ctrlKey: true, altKey: true })), key).toBeNull();
    }
    for (const sc of SHORTCUTS) {
      const c = parseCombo(sc.keys);
      expect(c?.mod && c.alt, sc.id).toBeFalsy();
    }
  });
  it("the theme has no default key, so nothing matches it", () => {
    expect(SHORTCUTS.find((s) => s.id === "toggle-theme")?.keys).toBe("");
  });
  it("accepts Cmd (meta) as Mod on macOS", () => {
    expect(matchShortcut(ev({ key: "t", metaKey: true }))).toBe("new-tab");
  });
  it("Ctrl+Mayús+T / W reopen a closed tab and close them all", () => {
    expect(matchShortcut(ev({ key: "T", ctrlKey: true, shiftKey: true }))).toBe("reopen-tab");
    expect(matchShortcut(ev({ key: "W", ctrlKey: true, shiftKey: true }))).toBe("close-all-tabs");
  });
  it("Ctrl+O, Ctrl+, and Ctrl+B open a file, the settings and toggle the panel", () => {
    expect(matchShortcut(ev({ key: "o", ctrlKey: true }))).toBe("open-file");
    expect(matchShortcut(ev({ key: ",", ctrlKey: true }))).toBe("open-settings");
    expect(matchShortcut(ev({ key: "b", metaKey: true }))).toBe("toggle-sidebar");
  });
  it("Ctrl+Mayús+E / H / K: explorer, history, connect", () => {
    expect(matchShortcut(ev({ key: "E", ctrlKey: true, shiftKey: true }))).toBe("focus-explorer");
    expect(matchShortcut(ev({ key: "H", ctrlKey: true, shiftKey: true }))).toBe("toggle-history");
    expect(matchShortcut(ev({ key: "K", ctrlKey: true, shiftKey: true }))).toBe("connect");
  });
  it("Ctrl+PageUp/Down cycle tabs", () => {
    expect(matchShortcut(ev({ key: "PageDown", ctrlKey: true }))).toBe("next-tab");
    expect(matchShortcut(ev({ key: "PageUp", ctrlKey: true }))).toBe("prev-tab");
  });
  it("Alt+Mayús+C / R commit and roll back the open transaction (#667, R-17)", () => {
    expect(matchShortcut(ev({ key: "C", altKey: true, shiftKey: true }))).toBe("tx-commit");
    expect(matchShortcut(ev({ key: "R", altKey: true, shiftKey: true }))).toBe("tx-rollback");
    expect(matchShortcut(ev({ key: "c", ctrlKey: true }))).toBeNull();
    expect(matchShortcut(ev({ key: "c", altKey: true }))).toBeNull();
  });
  it("reads the physical key when Option turned the letter into a symbol (macOS)", () => {
    expect(matchShortcut(ev({ key: "Ç", code: "KeyC", altKey: true, shiftKey: true }))).toBe("tx-commit");
    expect(matchShortcut(ev({ key: "‰", code: "KeyR", altKey: true, shiftKey: true }))).toBe("tx-rollback");
    // Without Alt the code is never consulted.
    expect(matchShortcut(ev({ key: "Ç", code: "KeyC", shiftKey: true }))).toBeNull();
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

describe("matchShortcut — filter (#592)", () => {
  it("Ctrl/Cmd+Shift+L adds a filter condition; without Shift it does not", () => {
    expect(matchShortcut(ev({ key: "L", ctrlKey: true, shiftKey: true }))).toBe("filter-add-condition");
    expect(matchShortcut(ev({ key: "l", metaKey: true, shiftKey: true }))).toBe("filter-add-condition");
    expect(matchShortcut(ev({ key: "l", ctrlKey: true }))).toBeNull();
  });

  // Issue #645: the ORDER BY sibling of Mod+Shift+L.
  it("maps Mod+Shift+O to filter-add-sort, and not without Shift", () => {
    expect(matchShortcut(ev({ key: "O", ctrlKey: true, shiftKey: true }))).toBe("filter-add-sort");
    expect(matchShortcut(ev({ key: "o", metaKey: true, shiftKey: true }))).toBe("filter-add-sort");
    expect(matchShortcut(ev({ key: "o", ctrlKey: true }))).toBe("open-file");
    expect(matchShortcut(ev({ key: "o", ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });
});

describe("matchShortcut — interface zoom (#681)", () => {
  it("Mod+= and Mod++ zoom in, with or without Shift (layouts differ)", () => {
    expect(matchShortcut(ev({ key: "=", ctrlKey: true }))).toBe("zoom-in");
    expect(matchShortcut(ev({ key: "+", ctrlKey: true, shiftKey: true }))).toBe("zoom-in");
    expect(matchShortcut(ev({ key: "+", metaKey: true }))).toBe("zoom-in");
  });
  it("Mod+- zooms out and Mod+0 resets", () => {
    expect(matchShortcut(ev({ key: "-", ctrlKey: true }))).toBe("zoom-out");
    expect(matchShortcut(ev({ key: "0", metaKey: true }))).toBe("zoom-reset");
  });
  it("leaves the bare keys and the Alt forms alone", () => {
    expect(matchShortcut(ev({ key: "+" }))).toBeNull();
    expect(matchShortcut(ev({ key: "0" }))).toBeNull();
    expect(matchShortcut(ev({ key: "-", ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe("matchShortcut — stop the running query (#691)", () => {
  it("Ctrl+Break stops it, however the browser names the key", () => {
    // Chromium on Windows reports Ctrl+Pause as "Cancel".
    expect(matchShortcut(ev({ key: "Cancel", ctrlKey: true }))).toBe("cancel-query");
    expect(matchShortcut(ev({ key: "Pause", ctrlKey: true }))).toBe("cancel-query");
    expect(matchShortcut(ev({ key: "Pause", metaKey: true }))).toBe("cancel-query");
  });
  it("leaves Pause alone without Ctrl", () => {
    expect(matchShortcut(ev({ key: "Pause" }))).toBeNull();
    expect(matchShortcut(ev({ key: "Cancel", ctrlKey: true, shiftKey: true }))).toBeNull();
  });
  it("is listed for the help as Ctrl+Pause", () => {
    const sc = SHORTCUTS.find((s) => s.id === "cancel-query")!;
    expect(sc.global).toBe(true);
    expect(formatKeys(sc.keys, "windows", (k) => (k === "key.pause" ? "Pausa" : k))).toBe("Ctrl+Pausa");
    expect(formatKeys(sc.keys, "macos")).toBe("⌘Pausa");
  });
});

describe("matchShortcut — non-matches", () => {
  it("does NOT match run-query globally (editor owns Mod+Enter)", () => {
    expect(matchShortcut(ev({ key: "Enter", ctrlKey: true }))).toBeNull();
  });
  it("ignores plain letters and unmodified typing", () => {
    expect(matchShortcut(ev({ key: "t" }))).toBeNull();
    expect(matchShortcut(ev({ key: "t", altKey: true, shiftKey: true }))).toBeNull();
  });
});

describe("formatKeys (R-33)", () => {
  const es: Record<string, string> = {
    "key.shift": "Mayús",
    "key.enter": "Intro",
    "key.delete": "Supr",
    "key.backspace": "Retroceso",
    "key.space": "Espacio",
    "key.pagedown": "Av Pág",
    "key.pageup": "Re Pág",
    "key.esc": "Esc",
  };
  const tr = (k: string) => es[k] ?? k;

  it("spells Windows and Linux keys in Spanish, joined by +", () => {
    expect(formatKeys("Mod+Shift+F", "windows", tr)).toBe("Ctrl+Mayús+F");
    expect(formatKeys("Mod+Enter", "linux", tr)).toBe("Ctrl+Intro");
    expect(formatKeys("Alt+Shift+C", "windows", tr)).toBe("Alt+Mayús+C");
    expect(formatKeys("Delete", "windows", tr)).toBe("Supr");
    expect(formatKeys("Backspace", "windows", tr)).toBe("Retroceso");
    expect(formatKeys("Mod+Space", "windows", tr)).toBe("Ctrl+Espacio");
    expect(formatKeys("Ctrl+PageDown", "windows", tr)).toBe("Ctrl+Av Pág");
    expect(formatKeys("Escape", "windows", tr)).toBe("Esc");
    expect(formatKeys("Shift+F12", "windows", tr)).toBe("Mayús+F12");
  });
  it("keeps the plus key, symbols and arrows", () => {
    expect(formatKeys("Mod++", "windows", tr)).toBe("Ctrl++");
    expect(formatKeys("Mod+,", "windows", tr)).toBe("Ctrl+,");
    expect(formatKeys("Alt+Shift+↑/↓", "windows", tr)).toBe("Alt+Mayús+↑/↓");
    expect(formatKeys("Mod+k", "windows", tr)).toBe("Ctrl+K");
  });
  it("writes macOS symbols in the order ⌃⌥⇧⌘, with no separators", () => {
    expect(formatKeys("Mod+Shift+F", "macos", tr)).toBe("⇧⌘F");
    expect(formatKeys("Shift+Mod+F", "macos", tr)).toBe("⇧⌘F");
    expect(formatKeys("Alt+Shift+C", "macos", tr)).toBe("⌥⇧C");
    expect(formatKeys("Mod+Enter", "macos", tr)).toBe("⌘↩");
    expect(formatKeys("Control+Alt+Mod+L", "macos", tr)).toBe("⌃⌥⌘L");
    expect(formatKeys("Delete", "macos", tr)).toBe("⌦");
    expect(formatKeys("Mod++", "macos", tr)).toBe("⌘+");
  });
  it("leaves «no key» empty", () => {
    expect(formatKeys("", "windows", tr)).toBe("");
    expect(formatKeys("", "macos", tr)).toBe("");
  });
  it("defaults to the catalog for the key names", () => {
    expect(formatKeys("Mod+Shift+Enter", "windows")).toMatch(/^Ctrl\+(Mayús|Shift)\+(Intro|Enter)$/);
  });
  it("keysOf reads the table in force", () => {
    expect(keysOf("refresh", SHORTCUTS, "windows")).toBe("F5");
    expect(keysOf("toggle-theme", SHORTCUTS, "windows")).toBe("");
    const rebound = effectiveShortcuts(setOverride({}, "refresh", "Mod+R"));
    expect(keysOf("refresh", rebound, "macos")).toBe("⌘R");
  });
});

describe("SHORTCUTS table", () => {
  it("documents every action id once", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The grid's row keys (#517): listed for the help overlay, never matched
  // globally — they only mean anything with the grid focused, and Mod+C / Mod+V
  // must stay the browser's everywhere else.
  it("lists the grid's row keys without claiming them globally", () => {
    for (const id of ["copy-rows", "duplicate-rows", "paste-rows", "unmark-rows"]) {
      const sc = SHORTCUTS.find((s) => s.id === id);
      expect(sc, id).toBeDefined();
      expect(sc!.global).toBe(false);
    }
    expect(matchShortcut(ev({ key: "c", ctrlKey: true }))).toBeNull();
    expect(matchShortcut(ev({ key: "d", ctrlKey: true }))).toBeNull();
    expect(matchShortcut(ev({ key: "v", ctrlKey: true }))).toBeNull();
    expect(matchShortcut(ev({ key: "Escape" }))).toBeNull();
  });
  it("run-query is present but not globally matched", () => {
    const run = SHORTCUTS.find((s) => s.id === "run-query");
    expect(run?.global).toBe(false);
  });
  it("lists the editor's script run and plan for F1, never matched globally (issue #691)", () => {
    expect(SHORTCUTS.find((s) => s.id === "run-script")).toMatchObject({ keys: "Mod+Shift+Enter", global: false });
    expect(SHORTCUTS.find((s) => s.id === "explain")).toMatchObject({ keys: "Mod+Shift+E", global: false });
    expect(matchShortcut(ev({ key: "Enter", ctrlKey: true, shiftKey: true }))).toBeNull();
    // Outside the editor the same keys go to the explorer (the editor's
    // keymap handles them first inside it; App yields to it).
    expect(matchShortcut(ev({ key: "e", ctrlKey: true, shiftKey: true }))).toBe("focus-explorer");
  });
});

describe("matchShortcut — snippets (issue #320)", () => {
  it("maps Mod+J to the snippet palette", () => {
    expect(matchShortcut(ev({ key: "j", ctrlKey: true }))).toBe("snippet-palette");
    expect(matchShortcut(ev({ key: "J", metaKey: true }))).toBe("snippet-palette");
  });

  it("maps Mod+Shift+S to saving the query as a snippet", () => {
    expect(matchShortcut(ev({ key: "s", ctrlKey: true, shiftKey: true }))).toBe("save-snippet");
    expect(matchShortcut(ev({ key: "S", metaKey: true, shiftKey: true }))).toBe("save-snippet");
  });

  it("does not fire either without its modifiers", () => {
    expect(matchShortcut(ev({ key: "j" }))).toBeNull();
    expect(matchShortcut(ev({ key: "s" }))).toBeNull();
    expect(matchShortcut(ev({ key: "j", ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it("lists both in the help overlay", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(ids).toContain("snippet-palette");
    expect(ids).toContain("save-snippet");
  });
});

describe("save the grid's edits (issue #436)", () => {
  it("maps a bare Mod+S to saving the edits", () => {
    expect(matchShortcut(ev({ key: "s", ctrlKey: true }))).toBe("save-edits");
    expect(matchShortcut(ev({ key: "S", metaKey: true }))).toBe("save-edits");
  });

  it("leaves Mod+Shift+S to the snippet, and a bare S to typing", () => {
    expect(matchShortcut(ev({ key: "s", ctrlKey: true, shiftKey: true }))).toBe("save-snippet");
    expect(matchShortcut(ev({ key: "s" }))).toBeNull();
    expect(matchShortcut(ev({ key: "s", ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("is listed in the help overlay", () => {
    expect(SHORTCUTS.find((s) => s.id === "save-edits")?.keys).toBe("Mod+S");
  });
});

// Rebinding (issue #684): the combo model, the overrides and the matcher that
// reads the effective table.
import {
  clearOverride,
  comboFromEvent,
  effectiveShortcuts,
  findConflicts,
  normalizeKeys,
  parseCombo,
  parseOverrides,
  serializeOverrides,
  setOverride,
  validateCombo,
} from "../../src/utils/shortcuts";

describe("parseCombo / normalizeKeys", () => {
  it("parses modifiers in any order and spelling into one canonical label", () => {
    expect(normalizeKeys("ctrl+shift+f")).toBe("Mod+Shift+F");
    expect(normalizeKeys("Shift+Mod+f")).toBe("Mod+Shift+F");
    expect(normalizeKeys("Cmd+Alt+l")).toBe("Mod+Alt+L");
    expect(normalizeKeys("Ctrl+PageDown")).toBe("Mod+PageDown");
  });
  it("reads a trailing + as the plus key, and drops Shift from symbols", () => {
    expect(parseCombo("Mod++")).toEqual({ mod: true, alt: false, shift: false, key: "+" });
    expect(normalizeKeys("Mod+Shift++")).toBe("Mod++");
    expect(normalizeKeys("Mod+-")).toBe("Mod+-");
  });
  it("spells Escape as Esc and keeps named keys", () => {
    expect(normalizeKeys("Escape")).toBe("Esc");
    expect(normalizeKeys("Shift+Enter")).toBe("Shift+Enter");
    expect(normalizeKeys("F5")).toBe("F5");
  });
  it("rejects an empty label, an unknown modifier and two keys", () => {
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("Mod+")).toBeNull();
    expect(parseCombo("Hyper+K")).toBeNull();
    expect(parseCombo("K+J")).toBeNull();
  });
  it("round-trips every default label", () => {
    for (const sc of SHORTCUTS.filter((s) => s.keys !== "")) {
      expect(normalizeKeys(sc.keys), sc.id).not.toBeNull();
      for (const alias of sc.aliases ?? []) expect(normalizeKeys(alias), alias).not.toBeNull();
    }
  });
});

describe("comboFromEvent", () => {
  it("writes the label of a key press, Mod for Ctrl or Cmd", () => {
    expect(comboFromEvent(ev({ key: "k", ctrlKey: true }))).toBe("Mod+K");
    expect(comboFromEvent(ev({ key: "K", metaKey: true, shiftKey: true }))).toBe("Mod+Shift+K");
    expect(comboFromEvent(ev({ key: "F6" }))).toBe("F6");
    expect(comboFromEvent(ev({ key: "Escape" }))).toBe("Esc");
  });
  it("waits while only modifiers are down", () => {
    expect(comboFromEvent(ev({ key: "Control", ctrlKey: true }))).toBeNull();
    expect(comboFromEvent(ev({ key: "Shift", shiftKey: true }))).toBeNull();
    expect(comboFromEvent(ev({ key: "Meta", metaKey: true }))).toBeNull();
    expect(comboFromEvent(ev({ key: "" }))).toBeNull();
  });
  it("drops Shift from a shifted symbol, so a US and a Spanish layout agree", () => {
    expect(comboFromEvent(ev({ key: "+", ctrlKey: true, shiftKey: true }))).toBe("Mod++");
  });
});

describe("validateCombo", () => {
  it("accepts a modified character and a bare named key", () => {
    expect(validateCombo("Mod+K")).toBeNull();
    expect(validateCombo("Alt+K")).toBeNull();
    expect(validateCombo("F9")).toBeNull();
    expect(validateCombo("Mod+Shift+Enter")).toBeNull();
  });
  it("refuses a bare or Shift-only character: that is typing", () => {
    expect(validateCombo("K")).toBe("bare-key");
    expect(validateCombo("Shift+K")).toBe("bare-key");
    expect(validateCombo("+")).toBe("bare-key");
  });
  it("refuses what does not parse", () => {
    expect(validateCombo("")).toBe("unparsable");
    expect(validateCombo("Hyper+K")).toBe("unparsable");
  });
});

describe("findConflicts", () => {
  it("names the other action on the same keys, in any spelling", () => {
    expect(findConflicts("ctrl+k", "new-tab", SHORTCUTS).map((s) => s.id)).toEqual(["command-palette"]);
    expect(findConflicts("Mod+K", "command-palette", SHORTCUTS)).toEqual([]);
  });
  it("counts the editor's and the grid's keys, which a global binding would double up", () => {
    expect(findConflicts("Mod+Enter", "refresh", SHORTCUTS).map((s) => s.id)).toEqual(["run-query"]);
    expect(findConflicts("Mod+C", "refresh", SHORTCUTS).map((s) => s.id)).toEqual(["copy-rows"]);
  });
  it("counts an alias, and sees Ctrl and Mod as the same key", () => {
    const withAlias = SHORTCUTS.map((s) => (s.id === "new-tab" ? { ...s, aliases: ["Mod+Alt+T"] } : s));
    expect(findConflicts("Mod+Alt+T", "refresh", withAlias).map((s) => s.id)).toEqual(["new-tab"]);
    expect(findConflicts("Mod+PageDown", "refresh", SHORTCUTS).map((s) => s.id)).toEqual(["next-tab"]);
  });
  it("finds nothing for a free combo or one that does not parse", () => {
    expect(findConflicts("Mod+Alt+9", "refresh", SHORTCUTS)).toEqual([]);
    expect(findConflicts("", "refresh", SHORTCUTS)).toEqual([]);
  });
});

describe("overrides", () => {
  it("stores only real changes, canonically spelled", () => {
    let o = setOverride({}, "refresh", "ctrl+r");
    expect(o).toEqual({ refresh: "Mod+R" });
    o = setOverride(o, "refresh", "F5"); // the default again
    expect(o).toEqual({});
  });
  it("ignores an invalid combo, a bare key and a fixed action", () => {
    expect(setOverride({}, "refresh", "Hyper+R")).toEqual({});
    expect(setOverride({}, "refresh", "R")).toEqual({});
    expect(setOverride({}, "run-query", "Mod+R")).toEqual({});
  });
  it("clears one, and serializes/parses the map", () => {
    const o = setOverride(setOverride({}, "refresh", "Mod+R"), "new-tab", "Mod+N");
    expect(clearOverride(o, "refresh")).toEqual({ "new-tab": "Mod+N" });
    expect(parseOverrides(serializeOverrides(o))).toEqual(o);
  });
  it("parses tolerantly: unknown ids, bad values, defaults and junk are dropped", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("{broken")).toEqual({});
    expect(parseOverrides("[1]")).toEqual({});
    expect(
      parseOverrides(
        JSON.stringify({ refresh: "ctrl+r", bogus: "Mod+X", "new-tab": 7, "close-tab": "Mod+W", "run-query": "Mod+Q" }),
      ),
    ).toEqual({ refresh: "Mod+R" });
  });
});

describe("effectiveShortcuts + matchShortcut with overrides", () => {
  const o = setOverride(setOverride({}, "refresh", "Mod+R"), "new-tab", "Mod+N");
  const base = SHORTCUTS.map((s) =>
    s.id === "new-tab" ? { ...s, aliases: ["Mod+Alt+T"] } : s.id === "close-tab" ? { ...s, aliases: ["Mod+Alt+W"] } : s,
  );
  const table = effectiveShortcuts(o, base);

  it("applies the override and drops the rebound action's aliases", () => {
    expect(table.find((s) => s.id === "refresh")?.keys).toBe("Mod+R");
    const tab = table.find((s) => s.id === "new-tab")!;
    expect(tab.keys).toBe("Mod+N");
    expect(tab.aliases).toBeUndefined();
    expect(table.find((s) => s.id === "close-tab")?.aliases).toEqual(["Mod+Alt+W"]);
  });
  it("matches the new keys and no longer the old ones", () => {
    expect(matchShortcut(ev({ key: "r", ctrlKey: true }), table)).toBe("refresh");
    expect(matchShortcut(ev({ key: "F5" }), table)).toBeNull();
    expect(matchShortcut(ev({ key: "n", metaKey: true }), table)).toBe("new-tab");
    expect(matchShortcut(ev({ key: "t", ctrlKey: true }), table)).toBeNull();
    expect(matchShortcut(ev({ key: "t", ctrlKey: true, altKey: true }), table)).toBeNull();
  });
  it("still never matches a fixed action", () => {
    expect(matchShortcut(ev({ key: "Enter", ctrlKey: true }), table)).toBeNull();
  });
  it("is the defaults with no overrides", () => {
    expect(effectiveShortcuts({})).toEqual(SHORTCUTS);
  });
});

describe("no key (R-17)", () => {
  it("stores «no key» for an action that has one by default, and matches nothing", () => {
    const o = setOverride({}, "refresh", "");
    expect(o).toEqual({ refresh: "" });
    const table = effectiveShortcuts(o);
    expect(table.find((s) => s.id === "refresh")?.keys).toBe("");
    expect(matchShortcut(ev({ key: "F5" }), table)).toBeNull();
    expect(parseOverrides(serializeOverrides(o))).toEqual({ refresh: "" });
  });
  it("is no override at all for an action that has no key by default", () => {
    expect(setOverride({}, "toggle-theme", "")).toEqual({});
  });
  it("lets the theme be given a key", () => {
    const table = effectiveShortcuts(setOverride({}, "toggle-theme", "Alt+Shift+T"));
    expect(matchShortcut(ev({ key: "T", altKey: true, shiftKey: true }), table)).toBe("toggle-theme");
  });
});

describe("migrateOverrides (version 1 to 2)", () => {
  it("keeps every binding the user made", () => {
    const v1 = { refresh: "Mod+R", "tx-commit": "Mod+Shift+Enter" };
    expect(migrateOverrides({ ...v1 }, 1)).toEqual(v1);
  });
  it("unbinds a new default that takes a key the user had given to another action", () => {
    // In version 1 Ctrl+Shift+H was free and the user put the help on it; the
    // history's new default must not steal it.
    const out = migrateOverrides({ "toggle-help": "Mod+Shift+H", refresh: "Alt+Shift+C" }, 1);
    expect(out).toEqual({ "toggle-help": "Mod+Shift+H", refresh: "Alt+Shift+C", "toggle-history": "", "tx-commit": "" });
    const table = effectiveShortcuts(out);
    expect(matchShortcut(ev({ key: "H", ctrlKey: true, shiftKey: true }), table)).toBe("toggle-help");
    expect(matchShortcut(ev({ key: "C", altKey: true, shiftKey: true }), table)).toBe("refresh");
  });
  it("leaves alone an action the user rebound themselves", () => {
    const out = migrateOverrides({ "toggle-help": "Mod+Shift+H", "toggle-history": "Mod+Alt+9" }, 1);
    expect(out["toggle-history"]).toBe("Mod+Alt+9");
  });
  it("does nothing to a map that is already current", () => {
    const o = { "toggle-help": "Mod+Shift+H" };
    expect(migrateOverrides(o, 2)).toBe(o);
  });
  it("is a no-op for no overrides", () => {
    expect(migrateOverrides({}, 1)).toEqual({});
  });
});
