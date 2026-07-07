// Keyboard shortcuts (issue #42). A pure keymap + matcher; App installs a
// document-level listener that maps events to action ids, and the help overlay
// renders this same list — so the shortcuts and their documentation never drift.
//
// "Mod" is Ctrl on Windows/Linux and Cmd (meta) on macOS. Running the query is
// owned by the CodeMirror editor (Mod-Enter); it is listed here for the help
// overlay but intentionally NOT matched globally, to avoid a double dispatch.

export type ActionId =
  | "run-query"
  | "format-sql"
  | "editor-find"
  | "object-palette"
  | "new-tab"
  | "close-tab"
  | "next-tab"
  | "prev-tab"
  | "refresh"
  | "toggle-theme"
  | "toggle-help"
  | "command-palette";

export interface Shortcut {
  id: ActionId;
  /** Human key label (Mod is rendered as Ctrl/⌘ by the help overlay). */
  keys: string;
  description: string;
  /** When false, App's global matcher ignores it (handled elsewhere). */
  global: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  { id: "run-query", keys: "Mod+Enter", description: "Ejecutar la consulta", global: false },
  { id: "format-sql", keys: "Mod+Shift+F", description: "Formatear la consulta", global: false },
  { id: "new-tab", keys: "Mod+Alt+T", description: "Nueva pestaña", global: true },
  { id: "close-tab", keys: "Mod+Alt+W", description: "Cerrar la pestaña activa", global: true },
  { id: "next-tab", keys: "Ctrl+PageDown", description: "Siguiente pestaña", global: true },
  { id: "prev-tab", keys: "Ctrl+PageUp", description: "Pestaña anterior", global: true },
  { id: "refresh", keys: "F5", description: "Refrescar datos y árbol", global: true },
  { id: "toggle-theme", keys: "Mod+Alt+L", description: "Cambiar tema claro/oscuro", global: true },
  { id: "toggle-help", keys: "F1", description: "Mostrar/ocultar atajos", global: true },
  { id: "command-palette", keys: "Mod+K", description: "Paleta de comandos", global: true },
  { id: "object-palette", keys: "Mod+P", description: "Buscar objetos (tablas, vistas…)", global: true },
  { id: "editor-find", keys: "Mod+F", description: "Buscar en el editor", global: true },
];

/** Minimal shape of the fields we read off a KeyboardEvent (testable). */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const mod = (e: KeyEventLike) => e.ctrlKey || e.metaKey;

/**
 * Map a key event to a global action id, or null if none matches. Only the
 * shortcuts marked `global` are matched here (run-query is the editor's).
 */
export function matchShortcut(e: KeyEventLike): ActionId | null {
  const k = e.key.toLowerCase();

  // Mod+Alt combinations (chosen to avoid clobbering common browser/OS keys
  // like Ctrl+T/Ctrl+W that a webview host may reserve).
  if (mod(e) && e.altKey && !e.shiftKey) {
    if (k === "t") return "new-tab";
    if (k === "w") return "close-tab";
    if (k === "l") return "toggle-theme";
  }

  // Ctrl/Cmd+K opens the command palette (issue #174), from any focus.
  if (mod(e) && !e.altKey && !e.shiftKey && k === "k") return "command-palette";

  // Ctrl/Cmd+P jumps to a connection object (tables, views…) via the palette;
  // Ctrl/Cmd+F searches inside the SQL editor. Both reclaim keys the webview
  // host would otherwise give to print / browser-find. Neither takes Alt/Shift
  // (Mod+Shift+F is the editor's formatter).
  if (mod(e) && !e.altKey && !e.shiftKey && k === "p") return "object-palette";
  if (mod(e) && !e.altKey && !e.shiftKey && k === "f") return "editor-find";

  // Ctrl+PageUp/PageDown cycle tabs (matches common editor/browser convention).
  if (e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.key === "PageDown") return "next-tab";
    if (e.key === "PageUp") return "prev-tab";
  }

  if (e.key === "F5" && !mod(e) && !e.altKey && !e.shiftKey) return "refresh";
  if (e.key === "F1" && !mod(e) && !e.altKey && !e.shiftKey) return "toggle-help";

  return null;
}

/** Render a `keys` label for display, resolving Mod to the platform key. */
export function displayKeys(keys: string, isMac: boolean): string {
  return keys.replace(/\bMod\b/g, isMac ? "⌘" : "Ctrl");
}
