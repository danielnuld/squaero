// Command model + filtering/grouping for the command palette (issue #174).
// Commands come from several sources (tools, tree objects, snippets, history,
// actions); this module fuzzy-filters and ranks them and groups the survivors
// by category in a stable, fixed category order. The filtering/grouping is pure
// and tested; the `run` closures are supplied by the workspace.

import { fuzzyMatch } from "./fuzzy";
import { t } from "./i18n";

export type CommandCategory = "tool" | "object" | "snippet" | "history" | "action";

export interface Command {
  /** Stable unique id (used as the list key). */
  id: string;
  category: CommandCategory;
  /** Primary text, matched first. */
  label: string;
  /** Secondary text (a table's database, a shortcut, the query source…). Also
      searched, but ranked below a label hit. */
  hint?: string;
  /** Perform the command. */
  run: () => void;
  /** Text shown beside the list while this command is highlighted — the body of
      a snippet, so it is not chosen by name alone (issue #320). */
  preview?: string;
  /** Alternate activations: Shift+Enter, Mod+Enter and Alt+Enter. A command
      that offers none is activated by `run` whatever the modifier. */
  runAlt?: (alt: "shift" | "mod" | "alt") => void;
  /** A line under the name in the preview pane (where a snippet runs). */
  detail?: string;
  /** Short tags beside the name in the preview pane (a template's abbreviation). */
  chips?: string[];
  /** Buttons in the preview pane (P6: Editar… / Insertar / Ejecutar / Abrir);
      the palette closes before one runs. The last `primary` one is the main. */
  actions?: { label: string; run: () => void; primary?: boolean; title?: string }[];
  /** Why it cannot run now. Listed anyway, marked unavailable, with the reason
      in place of the hint: a command that just vanishes cannot be learned. */
  disabled?: string;
}

/** Section headers, in the order sections appear in the palette. */
export const CATEGORY_ORDER: CommandCategory[] = [
  "action",
  "tool",
  "object",
  "snippet",
  "history",
];

/** Section headers, as catalog keys (shown in the UI's language). */
export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  action: "cmdk.cat.action",
  tool: "cmdk.cat.tool",
  object: "cmdk.cat.object",
  snippet: "cmdk.cat.snippet",
  history: "cmdk.cat.history",
};

// ---------------------------------------------------------------------------
// Scopes (the prototype's «Todo · Objetos · Acciones · Snippets»): Tab in the
// search box moves between them; each shows how many results it holds.

export type PaletteScope = "all" | "object" | "action" | "snippet";
export const SCOPES: PaletteScope[] = ["all", "object", "action", "snippet"];

/** Which scope a category belongs to (tools are actions; history, snippets). */
export function scopeOf(category: CommandCategory): Exclude<PaletteScope, "all"> {
  if (category === "tool") return "action";
  if (category === "history") return "snippet";
  return category;
}

export const inScope = (cmd: Command, scope: PaletteScope): boolean => scope === "all" || scopeOf(cmd.category) === scope;

/** The scopes worth offering for `commands`: «all» plus each one present, or none when only one is. */
export function scopesFor(commands: readonly Command[]): PaletteScope[] {
  const present = SCOPES.filter((s) => s !== "all" && commands.some((c) => inScope(c, s)));
  return present.length > 1 ? ["all", ...present] : [];
}

/** The scope after `current` (or before it, with `dir` -1), wrapping. */
export function nextScope(scopes: readonly PaletteScope[], current: PaletteScope, dir: 1 | -1): PaletteScope {
  if (scopes.length === 0) return current;
  const i = scopes.indexOf(current);
  return scopes[(Math.max(i, 0) + dir + scopes.length) % scopes.length];
}

// A label match ranks above a hint-only match regardless of raw fuzzy score.
const LABEL_BOOST = 1000;

/** Score a command against the query; -1 when it does not match at all. */
function scoreCommand(cmd: Command, query: string): number {
  const onLabel = fuzzyMatch(query, cmd.label);
  if (onLabel.matched) return LABEL_BOOST + onLabel.score;
  if (cmd.hint) {
    const onHint = fuzzyMatch(query, cmd.hint);
    if (onHint.matched) return onHint.score;
  }
  return -1;
}

/**
 * Fuzzy-filter and rank commands by the query. Non-matches are dropped; the rest
 * are sorted by score (desc), ties broken by original order (which encodes the
 * caller's category/insertion priority). An empty query keeps every command in
 * its original order.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  return commands
    .map((cmd, index) => ({ cmd, index, score: scoreCommand(cmd, query) }))
    .filter((e) => e.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((e) => e.cmd);
}

export interface CommandGroup {
  category: CommandCategory;
  label: string;
  items: Command[];
}

/**
 * Group commands by category in CATEGORY_ORDER, preserving each command's order
 * within its group. Empty categories are omitted.
 */
export function groupByCategory(commands: Command[]): CommandGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: t(CATEGORY_LABELS[category]),
    items: commands.filter((c) => c.category === category),
  })).filter((g) => g.items.length > 0);
}

/** Clamp an active-index selection into range, wrapping around the ends. */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}
