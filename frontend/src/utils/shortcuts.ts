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
  | "command-palette"
  | "snippet-palette"
  | "save-snippet"
  | "save-edits"
  | "select-rows";

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
  { id: "snippet-palette", keys: "Mod+J", description: "Buscar snippets guardados", global: true },
  { id: "save-snippet", keys: "Mod+Shift+S", description: "Guardar la consulta como snippet", global: true },
  { id: "save-edits", keys: "Mod+S", description: "Guardar los cambios de la rejilla", global: true },
  { id: "editor-find", keys: "Mod+F", description: "Buscar en el editor", global: true },
  // The grid owns it (it only makes sense with the grid focused), so it is
  // documented here but never matched globally.
  { id: "select-rows", keys: "Mod+A", description: "Seleccionar las filas de la rejilla", global: false },
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
  // Ctrl/Cmd+J searches the saved snippets (issue #320) — the third palette
  // mode, alongside commands and objects.
  if (mod(e) && !e.altKey && !e.shiftKey && k === "j") return "snippet-palette";
  // Ctrl/Cmd+Shift+S saves what the editor would run as a snippet. Shift is what
  // separates it from anything the host might claim on a bare Mod+S.
  if (mod(e) && !e.altKey && e.shiftKey && k === "s") return "save-snippet";
  // Bare Ctrl/Cmd+S commits the grid's pending edits — the reflex everyone
  // already has for "save". App no-ops it when nothing is being edited, and the
  // listener still preventDefaults so the host never runs its own "save page".
  if (mod(e) && !e.altKey && !e.shiftKey && k === "s") return "save-edits";
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
