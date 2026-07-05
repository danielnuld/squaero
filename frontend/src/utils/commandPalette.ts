// Command model + filtering/grouping for the command palette (issue #174).
// Commands come from several sources (tools, tree objects, snippets, history,
// actions); this module fuzzy-filters and ranks them and groups the survivors
// by category in a stable, fixed category order. The filtering/grouping is pure
// and tested; the `run` closures are supplied by the workspace.

import { fuzzyMatch } from "./fuzzy";

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
}

/** Section headers, in the order sections appear in the palette. */
export const CATEGORY_ORDER: CommandCategory[] = [
  "action",
  "tool",
  "object",
  "snippet",
  "history",
];

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  action: "Acciones",
  tool: "Herramientas",
  object: "Objetos",
  snippet: "Snippets",
  history: "Historial",
};

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
    label: CATEGORY_LABELS[category],
    items: commands.filter((c) => c.category === category),
  })).filter((g) => g.items.length > 0);
}

/** Clamp an active-index selection into range, wrapping around the ends. */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}
