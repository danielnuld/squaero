// Single source of truth for the connection tools (issue #176). Both the object
// tree's tools menu and the command palette render from this list, so their
// icons/labels stay consistent. Each item knows its tab title (what showTool
// passes) separately from its display label, so the deduped tab header matches
// regardless of entry point.

import type { ToolKind } from "./tabs";
import { monitorFor, unsupportedReason as monitorReason } from "./serverMonitor";
import { slowQuerySupport } from "./slowQueries";
import { userAdminFor, unsupportedReason as usersReason } from "./userAdmin";
import { routinesFor, unsupportedReason as routinesReason } from "./routines";
import { objectsFor, unsupportedReason as triggersReason } from "./triggers";
import { locale } from "./i18n";
import {
  IconBackup,
  IconBuilder,
  IconEr,
  IconMonitor,
  IconNotebook,
  IconPlug,
  IconRoutines,
  IconSlow,
  IconSearch,
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
  /** Where the tools menu lists it (audit A-18); absent = outside the groups
      (the saved connections belong to no connection). */
  group?: ToolGroup;
  /** Why the engine cannot run it, or null when it can. Absent = every engine. */
  unsupported?: (engine: string) => string | null;
}

/** The tools menu's sections, in order (ToolsMenu.body). */
export type ToolGroup = "schema" | "queries" | "server" | "data" | "compare";
export const TOOL_GROUPS: ToolGroup[] = ["schema", "queries", "server", "data", "compare"];

/** Why `tool` is not available on `engine`, or null when it is (or no engine is
    known yet — the tools need a connection anyway). */
export function toolUnsupported(tool: ToolMenuItem, engine: string | undefined): string | null {
  return engine && tool.unsupported ? tool.unsupported(engine) : null;
}

/** The catalog in menu order: each group's tools, then the ungrouped ones. */
export function toolsByGroup(): { group: ToolGroup | null; tools: ToolMenuItem[] }[] {
  const out: { group: ToolGroup | null; tools: ToolMenuItem[] }[] = TOOL_GROUPS.map((group) => ({
    group,
    tools: TOOL_CATALOG.filter((x) => x.group === group),
  }));
  out.push({ group: null, tools: TOOL_CATALOG.filter((x) => !x.group) });
  return out.filter((g) => g.tools.length > 0);
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
  { tool: "erDiagram", key: "er", Icon: IconEr, label: "tool.er.label", tabTitle: "tool.er.tab", title: "tool.er.title", group: "schema" },
  { tool: "queryBuilder", key: "qb", Icon: IconBuilder, label: "tool.qb.label", tabTitle: "tool.qb.tab", title: "tool.qb.title", group: "schema" },
  { tool: "routines", key: "routines", Icon: IconRoutines, label: "tool.routines.label", tabTitle: "tool.routines.tab", title: "tool.routines.title", group: "schema",
    unsupported: (e) => (routinesFor(e).supported ? null : routinesReason(e, locale())) },
  { tool: "triggers", key: "triggers", Icon: IconTriggers, label: "tool.triggers.label", tabTitle: "tool.triggers.tab", title: "tool.triggers.title", group: "schema",
    unsupported: (e) => (objectsFor(e, "trigger").supported ? null : triggersReason(e, "trigger")) },
  { tool: "notebook", key: "notebook", Icon: IconNotebook, label: "tool.notebook.label", tabTitle: "tool.notebook.tab", title: "tool.notebook.title", group: "queries" },
  { tool: "snippets", key: "snippets", Icon: IconSnippets, label: "tool.snippets.label", tabTitle: "tool.snippets.tab", title: "tool.snippets.title", group: "queries" },
  { tool: "monitor", key: "monitor", Icon: IconMonitor, label: "tool.monitor.label", tabTitle: "tool.monitor.tab", title: "tool.monitor.title", group: "server",
    unsupported: (e) => (monitorFor(e).supported ? null : monitorReason(e)) },
  { tool: "slowQueries", key: "slow", Icon: IconSlow, label: "tool.slow.label", tabTitle: "tool.slow.tab", title: "tool.slow.title", group: "server",
    unsupported: (e) => slowQuerySupport(e).reason },
  { tool: "users", key: "users", Icon: IconUsers, label: "tool.users.label", tabTitle: "tool.users.tab", title: "tool.users.title", group: "server",
    unsupported: (e) => (userAdminFor(e).supported ? null : usersReason(e)) },
  { tool: "dataSearch", key: "dataSearch", Icon: IconSearch, label: "tool.search.label", tabTitle: "tool.search.tab", title: "tool.search.title", group: "data" },
  { tool: "backup", key: "backup", Icon: IconBackup, label: "tool.backup.label", tabTitle: "tool.backup.tab", title: "tool.backup.title", group: "compare" },
  // Belongs to no connection: it is the list of the saved ones (issue #525).
  { tool: "connections", key: "connections", Icon: IconPlug, label: "tool.connections.label", tabTitle: "tool.connections.tab", title: "tool.connections.title" },
];
