// The shortcuts by area, and the search over them (M14 ShortcutsHelp,
// SettingsShortcuts): the reference and the editor list the same groups, and
// find an action by its name or by its keys. Pure.

import { fold } from "./connectionSearch";
import { formatKeys, type ActionId, type Shortcut } from "./shortcuts";
import type { Os } from "./dialog";

export type ShortcutGroup = "general" | "tabs" | "editor" | "tx" | "grid";

/** The groups in the order they are listed. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["general", "tabs", "editor", "tx", "grid"];

// A Record, so an action added to the table without a group fails to compile.
const GROUP_OF: Record<ActionId, ShortcutGroup> = {
  "command-palette": "general",
  "object-palette": "general",
  "snippet-palette": "general",
  refresh: "general",
  "toggle-theme": "general",
  "toggle-help": "general",
  "zoom-in": "general",
  "zoom-out": "general",
  "zoom-reset": "general",
  "new-tab": "tabs",
  "close-tab": "tabs",
  "reopen-tab": "tabs",
  "next-tab": "tabs",
  "prev-tab": "tabs",
  "run-query": "editor",
  "run-script": "editor",
  explain: "editor",
  "format-sql": "editor",
  "editor-find": "editor",
  "editor-definition": "editor",
  "editor-usages": "editor",
  "editor-rename": "editor",
  "save-snippet": "editor",
  "select-next-occurrence": "editor",
  "select-all-occurrences": "editor",
  "add-cursor": "editor",
  "expand-template": "editor",
  "cancel-query": "editor",
  "tx-commit": "tx",
  "tx-rollback": "tx",
  "filter-add-sort": "grid",
  "filter-add-condition": "grid",
  "add-condition": "grid",
  "save-edits": "grid",
  "select-rows": "grid",
  "copy-rows": "grid",
  "duplicate-rows": "grid",
  "paste-rows": "grid",
  "unmark-rows": "grid",
  "delete-rows": "grid",
  "related-row": "grid",
};

export const shortcutGroup = (id: ActionId): ShortcutGroup => GROUP_OF[id];

/**
 * The shortcuts of `group` (all when "all") whose action name or keys match
 * every word of `query`, case and accents aside, grouped in list order. Groups
 * left empty are dropped. `text` is the action's name as the UI shows it.
 */
export function groupShortcuts(
  table: readonly Shortcut[],
  opts: { query?: string; group?: ShortcutGroup | "all"; text: (sc: Shortcut) => string; os: Os },
): { group: ShortcutGroup; items: Shortcut[] }[] {
  const terms = fold(opts.query ?? "").split(/\s+/).filter(Boolean);
  const hit = (sc: Shortcut) => {
    if (terms.length === 0) return true;
    const text = fold(`${opts.text(sc)} ${sc.keys ? formatKeys(sc.keys, opts.os) : ""}`);
    return terms.every((term) => text.includes(term));
  };
  return SHORTCUT_GROUPS.filter((g) => (opts.group ?? "all") === "all" || opts.group === g)
    .map((group) => ({ group, items: table.filter((sc) => shortcutGroup(sc.id) === group && hit(sc)) }))
    .filter((g) => g.items.length > 0);
}
