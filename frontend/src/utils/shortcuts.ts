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
  | "add-condition"
  | "filter-add-condition"
  | "select-next-occurrence"
  | "select-all-occurrences"
  | "add-cursor"
  | "expand-template"
  | "tx-commit"
  | "tx-rollback"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset";

export interface Shortcut {
  id: ActionId;
  /** Human key label (Mod is rendered as Ctrl/⌘ by the help overlay). */
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
  // stay as aliases for those who learned them.
  { id: "new-tab", keys: "Mod+T", description: "sc.new-tab", global: true, aliases: ["Mod+Alt+T"] },
  { id: "close-tab", keys: "Mod+W", description: "sc.close-tab", global: true, aliases: ["Mod+Alt+W"] },
  { id: "next-tab", keys: "Ctrl+PageDown", description: "sc.next-tab", global: true },
  { id: "prev-tab", keys: "Ctrl+PageUp", description: "sc.prev-tab", global: true },
  { id: "refresh", keys: "F5", description: "sc.refresh", global: true },
  { id: "toggle-theme", keys: "Mod+Alt+L", description: "sc.toggle-theme", global: true },
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
  { id: "add-cursor", keys: "Mod+Alt+↑/↓", description: "sc.add-cursor", global: false },
  { id: "expand-template", keys: "Tab", description: "sc.expand-template", global: false },
  // End the connection's open transaction (issue #667); no-ops when none is.
  { id: "tx-commit", keys: "Mod+Alt+C", description: "sc.tx-commit", global: true },
  { id: "tx-rollback", keys: "Mod+Alt+R", description: "sc.tx-rollback", global: true },
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
const KEY_NAMES: Record<string, string> = { escape: "Esc", esc: "Esc", " ": "Space", spacebar: "Space" };

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

/** Whether a key event is this combo. */
export function matchesCombo(c: Combo, e: KeyEventLike): boolean {
  const key = normalizeKey(e.key);
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
    formatCombo({ mod: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey, key: normalizeKey(e.key) }),
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
 * default or invalid, so the stored map only ever holds real changes.
 */
export function setOverride(o: ShortcutOverrides, id: ActionId, keys: string): ShortcutOverrides {
  const base = byId.get(id);
  const next = { ...o };
  const canon = normalizeKeys(keys);
  if (!base || !isRebindable(base) || canon === null || validateCombo(keys) !== null || canon === normalizeKeys(base.keys)) {
    delete next[id];
  } else {
    next[id] = canon;
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

/** Render a `keys` label for display, resolving Mod to the platform key. */
export function displayKeys(keys: string, isMac: boolean): string {
  return keys.replace(/\bMod\b/g, isMac ? "⌘" : "Ctrl");
}
