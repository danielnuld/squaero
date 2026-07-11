// Single source of truth for the connection tools (issue #176). Both the object
// tree's 🧰 tools menu and the command palette render from this list, so their
// icons/labels stay consistent. Each item knows its tab title (what showTool
// passes) separately from its display label, so the deduped tab header matches
// regardless of entry point.

import type { ToolKind } from "./tabs";

export interface ToolMenuItem {
  tool: ToolKind;
  /** Dedupe key for showTool (so both entry points focus the same tab). */
  key: string;
  /** A short icon (emoji) shown before the label. */
  icon: string;
  /** i18n key for the display label (sidebar + palette). Resolve with t(). */
  label: string;
  /** i18n key for the tab header passed to showTool (may be shorter). */
  tabTitle: string;
  /** i18n key for the tooltip / accessible description. */
  title: string;
}

// label/tabTitle/title are i18n keys (see messages/{es,en}.ts, `tool.*`).
// Consumers render them with t(); `key`/`icon`/`tool` stay literal.
export const TOOL_CATALOG: ToolMenuItem[] = [
  { tool: "monitor", key: "monitor", icon: "🖥️", label: "tool.monitor.label", tabTitle: "tool.monitor.tab", title: "tool.monitor.title" },
  { tool: "slowQueries", key: "slow", icon: "🐢", label: "tool.slow.label", tabTitle: "tool.slow.tab", title: "tool.slow.title" },
  { tool: "users", key: "users", icon: "👥", label: "tool.users.label", tabTitle: "tool.users.tab", title: "tool.users.title" },
  { tool: "erDiagram", key: "er", icon: "🗺️", label: "tool.er.label", tabTitle: "tool.er.tab", title: "tool.er.title" },
  { tool: "queryBuilder", key: "qb", icon: "🧱", label: "tool.qb.label", tabTitle: "tool.qb.tab", title: "tool.qb.title" },
  { tool: "routines", key: "routines", icon: "ƒ", label: "tool.routines.label", tabTitle: "tool.routines.tab", title: "tool.routines.title" },
  { tool: "triggers", key: "triggers", icon: "⚡", label: "tool.triggers.label", tabTitle: "tool.triggers.tab", title: "tool.triggers.title" },
  { tool: "notebook", key: "notebook", icon: "📓", label: "tool.notebook.label", tabTitle: "tool.notebook.tab", title: "tool.notebook.title" },
];
