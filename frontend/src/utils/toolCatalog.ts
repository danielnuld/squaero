// Single source of truth for the connection tools (issue #176). Both the object
// tree's tools menu and the command palette render from this list, so their
// icons/labels stay consistent. Each item knows its tab title (what showTool
// passes) separately from its display label, so the deduped tab header matches
// regardless of entry point.

import type { ToolKind } from "./tabs";
import {
  IconBuilder,
  IconEr,
  IconMonitor,
  IconNotebook,
  IconRoutines,
  IconSlow,
  IconSnippets,
  IconTriggers,
  IconUsers,
  type IconComponent,
} from "../components/icons";

export interface ToolMenuItem {
  tool: ToolKind;
  /** Dedupe key for showTool (so both entry points focus the same tab). */
  key: string;
  /**
   * The tool's icon, used by every surface that shows one: the action ribbon and the
   * object tree's tools menu. A component rather than a character, so it takes the
   * colour of whatever it sits in — an emoji paints itself and ignores it.
   */
  Icon: IconComponent;
  /** i18n key for the display label (sidebar + palette). Resolve with t(). */
  label: string;
  /** i18n key for the tab header passed to showTool (may be shorter). */
  tabTitle: string;
  /** i18n key for the tooltip / accessible description. */
  title: string;
}

// label/tabTitle/title are i18n keys (see messages/{es,en}.ts, `tool.*`).
// Consumers render them with t(); `key`/`Icon`/`tool` stay literal.
//
// Snippets is here even though it is also reachable from the editor toolbar and
// Ctrl+J: the ribbon is where someone looks for a place they have not been yet. It
// sits with the tools rather than with query/table/objects, because those three
// CREATE something while opening the snippet library is consulting what already
// exists — same family as the notebook.
export const TOOL_CATALOG: ToolMenuItem[] = [
  { tool: "monitor", key: "monitor", Icon: IconMonitor, label: "tool.monitor.label", tabTitle: "tool.monitor.tab", title: "tool.monitor.title" },
  { tool: "slowQueries", key: "slow", Icon: IconSlow, label: "tool.slow.label", tabTitle: "tool.slow.tab", title: "tool.slow.title" },
  { tool: "users", key: "users", Icon: IconUsers, label: "tool.users.label", tabTitle: "tool.users.tab", title: "tool.users.title" },
  { tool: "erDiagram", key: "er", Icon: IconEr, label: "tool.er.label", tabTitle: "tool.er.tab", title: "tool.er.title" },
  { tool: "queryBuilder", key: "qb", Icon: IconBuilder, label: "tool.qb.label", tabTitle: "tool.qb.tab", title: "tool.qb.title" },
  { tool: "routines", key: "routines", Icon: IconRoutines, label: "tool.routines.label", tabTitle: "tool.routines.tab", title: "tool.routines.title" },
  { tool: "triggers", key: "triggers", Icon: IconTriggers, label: "tool.triggers.label", tabTitle: "tool.triggers.tab", title: "tool.triggers.title" },
  { tool: "notebook", key: "notebook", Icon: IconNotebook, label: "tool.notebook.label", tabTitle: "tool.notebook.tab", title: "tool.notebook.title" },
  { tool: "snippets", key: "snippets", Icon: IconSnippets, label: "tool.snippets.label", tabTitle: "tool.snippets.tab", title: "tool.snippets.title" },
];
