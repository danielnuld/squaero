// Keyboard shortcuts (issue #42). A pure keymap + matcher; App installs a
// document-level listener that maps events to action ids, and the help overlay
// renders this same list — so the shortcuts and their documentation never drift.
//
// "Mod" is Ctrl on Windows/Linux and Cmd (meta) on macOS. Running the query is
// owned by the CodeMirror editor (Mod-Enter); it is listed here for the help
// overlay but intentionally NOT matched globally, to avoid a double dispatch.
//
// Rebinding (issue #684): the user's choices are OVERRIDES — a map action id →
// keys — layered on this table by `effectiveShortcuts`. The matcher, the help
// overlay and the settings editor all read the effective table, so a rebound
// key is matched, documented and edited as one thing. Only the `global` actions
// can be rebound; the editor's and the grid's keys are owned by CodeMirror and
// the grid component, which do not read this table.

import type { Os } from "./dialog";
import { t } from "./i18n";

export type ActionId =
  | "run-query"
  | "run-script"
  | "explain"
  | "format-sql"
  | "editor-find"
  | "editor-definition"
  | "editor-usages"
  | "editor-rename"
  | "filter-add-sort"
  | "object-palette"
  | "new-tab"
  | "close-tab"
  | "next-tab"
  | "prev-tab"
  | "refresh"
  | "toggle-theme"
  | "toggle-help"
  | "command-palette"
  | "snippet-palette"
  | "save-snippet"
  | "save-edits"
  | "select-rows"
  | "copy-rows"
  | "duplicate-rows"
  | "paste-rows"
  | "unmark-rows"
  | "delete-rows"
  | "related-row"
  | "edit-cell"
  | "set-null"
  | "row-detail"
  | "fk-picker"
  | "copy-with-headers"
  | "pin-result"
  | "view-data"
  | "view-structure"
  | "view-indexes"
  | "view-ddl"
  | "add-condition"
  | "filter-add-condition"
  | "select-next-occurrence"
  | "select-all-occurrences"
  | "add-cursor"
  | "expand-template"
  | "tx-commit"
  | "tx-rollback"
  | "cancel-query"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  // M14 (R-17, audit P4): additive ids — the menus and the palette may name them.
  | "open-file"
  | "open-settings"
  | "toggle-sidebar"
  | "focus-explorer"
  | "toggle-history"
  | "connect"
  | "reopen-tab"
  | "close-all-tabs";

export interface Shortcut {
  id: ActionId;
  /** Key label (Mod is Ctrl or ⌘; `formatKeys` renders it). "" = no key. */
  keys: string;
  /** i18n KEY for the description ("sc.<id>"), resolved where it is shown. */
  description: string;
  /** When false, App's global matcher ignores it (handled elsewhere). */
  global: boolean;
  /** Older key labels still matched (not shown); dropped once the action is rebound. */
  aliases?: string[];
}

export const SHORTCUTS: Shortcut[] = [
  { id: "run-query", keys: "Mod+Enter", description: "sc.run-query", global: false },
  // The whole script, on purpose (issue #691): Mod+Enter runs one statement.
  { id: "run-script", keys: "Mod+Shift+Enter", description: "sc.run-script", global: false },
  // The editor owns it too (issue #131); it was missing here, so F1 never listed it.
  { id: "explain", keys: "Mod+Shift+E", description: "sc.explain", global: false },
  { id: "format-sql", keys: "Mod+Shift+F", description: "sc.format-sql", global: false },
  // Ctrl/Cmd+T and +W open and close a tab, as in a browser (issue #591); the
  // listener's preventDefault keeps them from the host. The older Mod+Alt forms
  // are gone (R-17): Ctrl+Alt is AltGr on many keyboards, which types letters.
  { id: "new-tab", keys: "Mod+T", description: "sc.new-tab", global: true },
  { id: "close-tab", keys: "Mod+W", description: "sc.close-tab", global: true },
  { id: "close-all-tabs", keys: "Mod+Shift+W", description: "sc.close-all-tabs", global: true },
  { id: "reopen-tab", keys: "Mod+Shift+T", description: "sc.reopen-tab", global: true },
  { id: "next-tab", keys: "Ctrl+PageDown", description: "sc.next-tab", global: true },
  { id: "prev-tab", keys: "Ctrl+PageUp", description: "sc.prev-tab", global: true },
  { id: "refresh", keys: "F5", description: "sc.refresh", global: true },
  // No default key (R-17): Ctrl+Alt+L locks the screen on many Linux desktops.
  // It stays rebindable and in the palette.
  { id: "toggle-theme", keys: "", description: "sc.toggle-theme", global: true },
  { id: "open-settings", keys: "Mod+,", description: "sc.open-settings", global: true },
  // Mod+B is also the grid's «related row»; with a foreign-key cell focused the
  // grid takes it (it calls preventDefault) and the panel stays put.
  { id: "toggle-sidebar", keys: "Mod+B", description: "sc.toggle-sidebar", global: true },
  // Mod+Shift+E is also the editor's Explain; inside the editor that one wins.
  { id: "focus-explorer", keys: "Mod+Shift+E", description: "sc.focus-explorer", global: true },
  { id: "toggle-history", keys: "Mod+Shift+H", description: "sc.toggle-history", global: true },
  { id: "connect", keys: "Mod+Shift+K", description: "sc.connect", global: true },
  { id: "open-file", keys: "Mod+O", description: "sc.open-file", global: true },
  { id: "toggle-help", keys: "F1", description: "sc.toggle-help", global: true },
  { id: "command-palette", keys: "Mod+K", description: "sc.command-palette", global: true },
  { id: "object-palette", keys: "Mod+P", description: "sc.object-palette", global: true },
  { id: "snippet-palette", keys: "Mod+J", description: "sc.snippet-palette", global: true },
  { id: "save-snippet", keys: "Mod+Shift+S", description: "sc.save-snippet", global: true },
  { id: "save-edits", keys: "Mod+S", description: "sc.save-edits", global: true },
  { id: "editor-find", keys: "Mod+F", description: "sc.editor-find", global: true },
  // The SQL editor owns these (issues #663, #664); documented, never matched globally.
  { id: "editor-definition", keys: "F12", description: "sc.editor-definition", global: false },
  { id: "editor-usages", keys: "Shift+F12", description: "sc.editor-usages", global: false },
  { id: "editor-rename", keys: "F2", description: "sc.editor-rename", global: false },
  // The grid owns these (they only make sense with the grid focused), so they
  // are documented here but never matched globally. Copy and duplicate act on
  // the marked rows, or the selected cell's row; paste comes in on the paste
  // event, which is what carries the clipboard (#517).
  { id: "select-rows", keys: "Mod+A", description: "sc.select-rows", global: false },
  { id: "copy-rows", keys: "Mod+C", description: "sc.copy-rows", global: false },
  { id: "duplicate-rows", keys: "Mod+D", description: "sc.duplicate-rows", global: false },
  { id: "paste-rows", keys: "Mod+V", description: "sc.paste-rows", global: false },
  { id: "unmark-rows", keys: "Esc", description: "sc.unmark-rows", global: false },
  { id: "delete-rows", keys: "Delete", description: "sc.delete-rows", global: false },
  { id: "related-row", keys: "Mod+B", description: "sc.related-row", global: false },
  // In-place editing (R-14): F2 opens the selected cell, Mod+Shift+N writes NULL.
  { id: "edit-cell", keys: "F2", description: "sc.edit-cell", global: false },
  { id: "set-null", keys: "Mod+Shift+N", description: "sc.set-null", global: false },
  { id: "row-detail", keys: "Space", description: "sc.row-detail", global: false },
  { id: "fk-picker", keys: "Alt+↓", description: "sc.fk-picker", global: false },
  { id: "copy-with-headers", keys: "Mod+Shift+C", description: "sc.copy-with-headers", global: false },
  // Keep the result on screen aside, to compare the next run with it (#669).
  { id: "pin-result", keys: "Mod+Shift+P", description: "sc.pin-result", global: true },
  // Datos · Estructura · Índices · DDL of the table on screen (R-12).
  { id: "view-data", keys: "Alt+1", description: "sc.view-data", global: true },
  { id: "view-structure", keys: "Alt+2", description: "sc.view-structure", global: true },
  { id: "view-indexes", keys: "Alt+3", description: "sc.view-indexes", global: true },
  { id: "view-ddl", keys: "Alt+4", description: "sc.view-ddl", global: true },
  // The filter panel owns it (issue #462): Enter there applies the draft, so
  // Shift+Enter is the "one more line" of the same reflex. Not matched globally.
  { id: "add-condition", keys: "Shift+Enter", description: "sc.add-condition", global: false },
  // From anywhere in a table/view tab — the grid included — straight into a new
  // filter condition (issue #592). App ignores it on any other tab.
  { id: "filter-add-condition", keys: "Mod+Shift+L", description: "sc.filter-add-condition", global: true },
  // Its sibling for the ORDER BY (issue #645).
  { id: "filter-add-sort", keys: "Mod+Shift+O", description: "sc.filter-add-sort", global: true },
  // The SQL editor's multicursor and templates (issue #665): CodeMirror's own
  // keymaps, documented here, never matched globally. Mod+D is the grid's too
  // (each acts where it has focus), and Mod+Shift+L the filter's, which only
  // acts on a table tab — one with no editor.
  { id: "select-next-occurrence", keys: "Mod+D", description: "sc.select-next-occurrence", global: false },
  { id: "select-all-occurrences", keys: "Mod+Shift+L", description: "sc.select-all-occurrences", global: false },
  { id: "add-cursor", keys: "Alt+Shift+↑/↓", description: "sc.add-cursor", global: false },
  { id: "expand-template", keys: "Tab", description: "sc.expand-template", global: false },
  // End the connection's open transaction (issue #667); no-ops when none is.
  // Alt+Shift, not Ctrl+Alt (R-17): Ctrl+Alt+C is AltGr+C, which types «ć».
  { id: "tx-commit", keys: "Alt+Shift+C", description: "sc.tx-commit", global: true },
  { id: "tx-rollback", keys: "Alt+Shift+R", description: "sc.tx-rollback", global: true },
  // Stop the running query (issue #691), as in SSMS and most SQL clients. With
  // Ctrl held, Pause/Break reaches the page as "Cancel" (see KEY_NAMES).
  { id: "cancel-query", keys: "Mod+Pause", description: "sc.cancel-query", global: true },
  // The interface's own zoom (issue #681): it scales the type scale, not the
  // page, and takes the keys the webview host would spend on browser zoom.
  { id: "zoom-in", keys: "Mod++", description: "sc.zoom-in", global: true },
  { id: "zoom-out", keys: "Mod+-", description: "sc.zoom-out", global: true },
  { id: "zoom-reset", keys: "Mod+0", description: "sc.zoom-reset", global: true },
];

/** Minimal shape of the fields we read off a KeyboardEvent (testable). */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Physical key ("KeyC"): read only when Alt turned the letter into another
      character, as Option does on a Mac (⌥⇧C reports «Ç»). */
  code?: string;
}

// ---------------------------------------------------------------------------
// Key combos. A `keys` label ("Mod+Shift+F") is data: parsed once into a Combo,
// matched against events, and written back in one canonical spelling so two
// labels for the same keys compare equal ("ctrl+shift+f" is "Mod+Shift+F").

export interface Combo {
  /** Ctrl or Cmd. A literal "Ctrl" in a label means the same: on Windows and
      Linux it IS the same key, and on a Mac either is fine. */
  mod: boolean;
  alt: boolean;
  shift: boolean;
  /** Canonical key name: a single character upper-cased, or a named key
      ("Enter", "F5", "PageDown", "Esc"). */
  key: string;
}

const MODIFIER_TOKENS: Record<string, keyof Omit<Combo, "key">> = {
  mod: "mod",
  ctrl: "mod",
  control: "mod",
  meta: "mod",
  cmd: "mod",
  command: "mod",
  alt: "alt",
  option: "alt",
  shift: "shift",
};

/** Keys whose name the browser spells differently from the label. */
// Ctrl+Pause is reported as "Cancel" (the key's Ctrl+Break meaning), and some
// layouts label the key "Break": all three are the one Pause key.
const KEY_NAMES: Record<string, string> = {
  escape: "Esc",
  esc: "Esc",
  " ": "Space",
  spacebar: "Space",
  cancel: "Pause",
  break: "Pause",
};

/** Canonical spelling of one key: letters upper-cased, named keys as the DOM spells them. */
function normalizeKey(key: string): string {
  const named = KEY_NAMES[key.toLowerCase()];
  if (named) return named;
  if (key.length === 1) return key.toUpperCase();
  // Named keys ("pagedown" → "PageDown") are matched case-insensitively, so the
  // canonical form keeps whatever casing was given.
  return key;
}

/** A single printable character, as opposed to a named key. */
const isCharacter = (key: string) => key.length === 1;

/** Letters and digits take Shift literally; symbols do not (see matchesCombo). */
const isAlphanumeric = (key: string) => /^[A-Z0-9]$/i.test(key);

/**
 * Parse a key label into a Combo, or null when it names no key, an unknown
 * modifier, or more than one key. A trailing "+" is the plus key ("Mod++").
 */
export function parseCombo(keys: string): Combo | null {
  const parts = keys.split("+");
  let key = parts.pop() ?? "";
  // "Mod++" splits into ["Mod", "", ""]: the two empties are the plus key.
  if (key === "" && parts.length > 0 && parts[parts.length - 1] === "") {
    key = "+";
    parts.pop();
  }
  key = key.trim();
  if (key === "") return null;
  const combo: Combo = { mod: false, alt: false, shift: false, key: normalizeKey(key) };
  for (const part of parts) {
    const flag = MODIFIER_TOKENS[part.trim().toLowerCase()];
    if (!flag) return null;
    combo[flag] = true;
  }
  // Symbols never carry Shift: "+" is Shift+= on a US layout and its own key on
  // a Spanish one, so the label is the same for both.
  if (isCharacter(combo.key) && !isAlphanumeric(combo.key)) combo.shift = false;
  return combo;
}

/** The canonical label of a Combo (the only spelling the overrides store). */
export function formatCombo(c: Combo): string {
  const parts: string[] = [];
  if (c.mod) parts.push("Mod");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  parts.push(c.key);
  return parts.join("+");
}

/** Canonical spelling of a label, or null when it does not parse. */
export function normalizeKeys(keys: string): string | null {
  const c = parseCombo(keys);
  return c ? formatCombo(c) : null;
}

/** The letter or digit of a physical key code ("KeyC" → "C"), or null. */
const codeChar = (code: string | undefined): string | null => /^(?:Key|Digit)([A-Z0-9])$/.exec(code ?? "")?.[1] ?? null;

/** The event's key, or with Alt its physical letter when Alt made it a symbol. */
function eventKey(e: KeyEventLike): string {
  const key = normalizeKey(e.key);
  if (!e.altKey || isAlphanumeric(key)) return key;
  return codeChar(e.code) ?? key;
}

/** Whether a key event is this combo. */
export function matchesCombo(c: Combo, e: KeyEventLike): boolean {
  const key = eventKey(e);
  const mod = e.ctrlKey || e.metaKey;
  if (c.mod !== mod || c.alt !== e.altKey) return false;
  if (isCharacter(c.key) && !isAlphanumeric(c.key)) {
    // `=` alone zooms in too, as in every browser; the numpad's +, - and 0
    // report the same `key` as the row keys.
    return c.key === key || (c.key === "+" && key === "=");
  }
  if (c.shift !== e.shiftKey) return false;
  return isCharacter(c.key) ? c.key === key : c.key.toLowerCase() === key.toLowerCase();
}

const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta", "os", "altgraph", "dead", "unidentified", "process"]);

/**
 * The canonical label for a key event, for capturing a new binding; null while
 * only modifiers are down (the user is still pressing the combo).
 */
export function comboFromEvent(e: KeyEventLike): string | null {
  if (!e.key || MODIFIER_KEYS.has(e.key.toLowerCase())) return null;
  // Round-tripped through the parser so the Shift-on-symbols rule applies.
  return normalizeKeys(
    formatCombo({ mod: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey, key: eventKey(e) }),
  );
}

export type ComboError = "unparsable" | "bare-key";

/**
 * Why a label cannot be a global shortcut: it does not parse, or it is a
 * printable character with neither Ctrl/Cmd nor Alt — that is typing, and a
 * global listener would steal it from every text field. Named keys (F5, Esc,
 * Delete, PageDown…) may stand alone.
 */
export function validateCombo(keys: string): ComboError | null {
  const c = parseCombo(keys);
  if (!c) return "unparsable";
  if (isCharacter(c.key) && !c.mod && !c.alt) return "bare-key";
  return null;
}

/** Every label a shortcut answers to, canonical. */
const labelsOf = (sc: Shortcut): string[] =>
  [sc.keys, ...(sc.aliases ?? [])].map(normalizeKeys).filter((k): k is string => k !== null);

/**
 * The other actions in `table` already bound to `keys` — editor- and grid-owned
 * ones included, because a global binding on Mod+Enter would fire on top of the
 * editor's run, not instead of it.
 */
export function findConflicts(keys: string, id: ActionId, table: readonly Shortcut[]): Shortcut[] {
  const wanted = normalizeKeys(keys);
  if (wanted === null) return [];
  return table.filter((sc) => sc.id !== id && labelsOf(sc).includes(wanted));
}

// ---------------------------------------------------------------------------
// Overrides: what the user changed, and nothing else.

export type ShortcutOverrides = Partial<Record<ActionId, string>>;

const byId = new Map(SHORTCUTS.map((sc) => [sc.id, sc]));

/** Whether an action's keys may be changed by the user. */
export const isRebindable = (sc: Shortcut): boolean => sc.global;

/**
 * Parse persisted overrides, tolerantly: anything that is not a known
 * rebindable action with a valid combo is dropped, and a value equal to the
 * default is not an override. Never throws.
 */
export function parseOverrides(raw: string | null | undefined): ShortcutOverrides {
  if (!raw) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  let out: ShortcutOverrides = {};
  for (const [id, keys] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof keys === "string" && byId.has(id as ActionId)) {
      out = setOverride(out, id as ActionId, keys);
    }
  }
  return out;
}

export function serializeOverrides(o: ShortcutOverrides): string {
  return JSON.stringify(o);
}

/**
 * Overrides with `id` bound to `keys` — or unbound again when `keys` is the
 * default or invalid, so the stored map only ever holds real changes. `""`
 * means «no key» and is stored only for an action that has one by default.
 */
export function setOverride(o: ShortcutOverrides, id: ActionId, keys: string): ShortcutOverrides {
  const base = byId.get(id);
  const next = { ...o };
  if (base && isRebindable(base) && keys === "" && base.keys !== "") {
    next[id] = "";
    return next;
  }
  const canon = normalizeKeys(keys);
  if (!base || !isRebindable(base) || canon === null || validateCombo(keys) !== null || canon === normalizeKeys(base.keys)) {
    delete next[id];
  } else {
    next[id] = canon;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Migration of stored overrides. A version-1 map was written against older
// defaults; version 2 (R-17) moved the Ctrl+Alt keys and added new actions. A
// user's own binding must keep working, so where a NEW default takes a key the
// user had already given to another action, the new default is unbound
// instead — the user's choice wins and nothing they set is lost.

export const SHORTCUTS_VERSION = 2;

/** The version-1 defaults of every action whose default changed in version 2
    ("" = the action did not exist). */
const V1_CHANGED: Partial<Record<ActionId, string>> = {
  "tx-commit": "Mod+Alt+C",
  "tx-rollback": "Mod+Alt+R",
  "toggle-theme": "Mod+Alt+L",
  "open-file": "",
  "open-settings": "",
  "toggle-sidebar": "",
  "focus-explorer": "",
  "toggle-history": "",
  connect: "",
  "reopen-tab": "",
  "close-all-tabs": "",
};

/** Bring overrides stored at `from` up to the current version. */
export function migrateOverrides(o: ShortcutOverrides, from: number): ShortcutOverrides {
  if (from >= SHORTCUTS_VERSION) return o;
  let next = { ...o };
  const taken = new Set(Object.values(o).map((k) => normalizeKeys(k ?? "")).filter((k) => k !== null));
  for (const id of Object.keys(V1_CHANGED) as ActionId[]) {
    const keys = normalizeKeys(byId.get(id)?.keys ?? "");
    if (keys !== null && next[id] === undefined && taken.has(keys)) next = setOverride(next, id, "");
  }
  return next;
}

/** Overrides without `id` (back to the default). */
export function clearOverride(o: ShortcutOverrides, id: ActionId): ShortcutOverrides {
  const next = { ...o };
  delete next[id];
  return next;
}

/**
 * The table in force: the defaults with the user's keys applied. A rebound
 * action loses its aliases — they were spellings of the old key.
 */
export function effectiveShortcuts(
  overrides: ShortcutOverrides,
  base: readonly Shortcut[] = SHORTCUTS,
): Shortcut[] {
  return base.map((sc) => {
    const keys = overrides[sc.id];
    if (keys === undefined || !isRebindable(sc)) return sc;
    const { aliases: _dropped, ...rest } = sc;
    return { ...rest, keys };
  });
}

/**
 * Map a key event to a global action id, or null if none matches. Only the
 * shortcuts marked `global` are matched here (run-query is the editor's).
 * `table` is the effective table (defaults when omitted).
 */
export function matchShortcut(e: KeyEventLike, table: readonly Shortcut[] = SHORTCUTS): ActionId | null {
  for (const sc of table) {
    if (!sc.global) continue;
    for (const label of [sc.keys, ...(sc.aliases ?? [])]) {
      const c = parseCombo(label);
      if (c && matchesCombo(c, e)) return sc.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Key notation (R-33, rule 9): one formatter for every place keys are shown.
// Windows and Linux: «Ctrl+Mayús+F», the key names in the UI's language.
// macOS: «⇧⌘F», the modifier symbols in the HIG order ⌃⌥⇧⌘, then the key.

/** Modifier tokens: the macOS symbol and its place in the order. */
const MAC_MODS: Record<string, [symbol: string, order: number]> = {
  control: ["⌃", 0],
  alt: ["⌥", 1],
  option: ["⌥", 1],
  shift: ["⇧", 2],
  mod: ["⌘", 3],
  ctrl: ["⌘", 3],
  cmd: ["⌘", 3],
  meta: ["⌘", 3],
};

/** Named keys whose label is translated (catalog `key.<name>`). */
const NAMED = new Set(["shift", "enter", "delete", "backspace", "space", "pagedown", "pageup", "esc", "pause"]);

const MAC_KEYS: Record<string, string> = {
  enter: "↩",
  delete: "⌦",
  backspace: "⌫",
  tab: "⇥",
  esc: "⎋",
  escape: "⎋",
  pagedown: "⇟",
  pageup: "⇞",
};

/** Split a label into tokens; a trailing "++" is the plus key. */
const tokensOf = (keys: string): string[] =>
  (keys.endsWith("++") ? [...keys.slice(0, -2).split("+"), "+"] : keys.split("+")).map((k) => k.trim());

/**
 * A key label as the user reads it on `os`. `tr` names the translated keys
 * (Mayús, Intro, Supr…) and defaults to the catalog. "" (no key) stays "".
 */
export function formatKeys(keys: string, os: Os, tr: (key: string) => string = t): string {
  if (!keys) return "";
  const parts = tokensOf(keys);
  const name = (k: string) => {
    const low = k.toLowerCase() === "escape" ? "esc" : k.toLowerCase();
    const mod = MAC_MODS[low];
    if (low === "control" || mod?.[1] === 3) return "Ctrl";
    if (mod?.[1] === 1) return "Alt";
    if (NAMED.has(low)) return tr(`key.${low}`);
    return k.length === 1 ? k.toUpperCase() : k;
  };
  if (os !== "macos") return parts.map(name).join("+");
  const isMod = (k: string) => MAC_MODS[k.toLowerCase()] !== undefined;
  const symbols = parts
    .filter(isMod)
    .map((k) => MAC_MODS[k.toLowerCase()])
    .sort((a, b) => a[1] - b[1])
    .map(([sym]) => sym);
  const rest = parts.filter((k) => !isMod(k)).map((k) => MAC_KEYS[k.toLowerCase()] ?? name(k));
  return [...new Set(symbols)].join("") + rest.join("+");
}

/** The keys of action `id` in `table`, formatted for `os`; "" when it has none. */
export function keysOf(id: ActionId, table: readonly Shortcut[], os: Os): string {
  return formatKeys(table.find((sc) => sc.id === id)?.keys ?? "", os);
}
