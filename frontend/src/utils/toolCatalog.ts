// Single source of truth for the connection tools (issue #176). Both the sidebar
// "Herramientas" section and the command palette render from this list, so their
// icons/labels stay consistent. Each item knows its tab title (what showTool
// passes) separately from its display label, so the deduped tab header matches
// regardless of entry point. The collapsed state of the sidebar section persists
// in the shared kvStore.

import type { ToolKind } from "./tabs";
import { resolveStore } from "./kvStore";

export interface ToolMenuItem {
  tool: ToolKind;
  /** Dedupe key for showTool (so both entry points focus the same tab). */
  key: string;
  /** A short icon (emoji) shown before the label. */
  icon: string;
  /** Display label in the sidebar and the palette. */
  label: string;
  /** The tab header passed to showTool (may be shorter than the label). */
  tabTitle: string;
  /** Tooltip / accessible description. */
  title: string;
}

export const TOOL_CATALOG: ToolMenuItem[] = [
  { tool: "monitor", key: "monitor", icon: "🖥️", label: "Monitor de servidor", tabTitle: "Monitor de servidor", title: "Monitor de servidor y lista de procesos" },
  { tool: "slowQueries", key: "slow", icon: "🐢", label: "Consultas lentas", tabTitle: "Consultas lentas", title: "Consultas más lentas registradas por el servidor" },
  { tool: "users", key: "users", icon: "👥", label: "Usuarios y permisos", tabTitle: "Usuarios y permisos", title: "Usuarios y permisos" },
  { tool: "erDiagram", key: "er", icon: "🗺️", label: "Diagrama ER", tabTitle: "Diagrama ER", title: "Diagrama entidad-relación" },
  { tool: "queryBuilder", key: "qb", icon: "🧱", label: "Constructor de consultas", tabTitle: "Constructor", title: "Constructor visual de consultas" },
  { tool: "routines", key: "routines", icon: "ƒ", label: "Procedimientos y funciones", tabTitle: "Procedimientos", title: "Procedimientos almacenados y funciones" },
  { tool: "triggers", key: "triggers", icon: "⚡", label: "Triggers y eventos", tabTitle: "Triggers y eventos", title: "Triggers y eventos programados" },
];

const COLLAPSED_KEY = "quaero.tools.collapsed";

/** Whether the sidebar tools section is collapsed (default false = expanded). */
export function loadToolsCollapsed(): boolean {
  try {
    return resolveStore().getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the collapsed state. Best-effort. */
export function saveToolsCollapsed(collapsed: boolean): void {
  try {
    resolveStore().setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* best-effort */
  }
}
