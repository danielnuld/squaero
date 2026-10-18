// Browser behaviours the webview host would otherwise keep (issue #685): the
// keys that reload, zoom, print, open or navigate, Ctrl+wheel zoom, and a file
// dropped on the window replacing the page. The shell disables what each engine
// has an API for; this is the complement that behaves the same on all three.
//
// Deliberately disjoint from the app's own shortcuts (shortcuts.ts): a key the
// app binds is matched — and preventDefault-ed — by App's listener, so it is not
// listed here. F5 (refresh), Mod+P (objects), Mod+F (find), Mod+J, Mod+K,
// Mod+S, Mod+T, Mod+W are the app's; Ctrl+R, Ctrl+Shift+R, Ctrl+F5 are not.

import type { KeyEventLike } from "./shortcuts";

/**
 * The browser's accelerator key: Cmd on macOS, Ctrl elsewhere — and ONLY that
 * one. On a Mac, Ctrl+E/H/N/P/O in a text field are the system's line and
 * cursor bindings, not Chrome's, so Ctrl must never count as "Mod" there.
 */
const mod = (e: KeyEventLike, isMac: boolean) => (isMac ? e.metaKey : e.ctrlKey);

/** Mod+<letter> combinations with no app meaning and a browser default. */
const BROWSER_MOD_KEYS = new Set([
  "r", // reload
  "u", // view source
  "o", // open file (navigates to it)
  "n", // new window
  "h", // history
  "l", // location bar
  "g", // find next
  "e", // search
]);

/** Zoom keys, with or without Shift (Ctrl+Shift+= is "+" on most layouts). */
const ZOOM_KEYS = new Set(["+", "=", "-", "0"]);

/** Function keys with a browser default the app does not use. */
const BROWSER_FN_KEYS = new Set(["F3", "F6", "F7", "F11"]);

/** True for a target that takes text, where Alt/Cmd+arrows are editing keys. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * Does this key only mean something to a browser? True for the reload, zoom,
 * open/new-window, history, location and find-next keys, and for the history
 * keys — Alt+←/→ (Cmd+←/→ and Cmd+[/] on a Mac) and the dedicated BrowserBack/
 * BrowserForward keys — outside a text field: inside one, Alt/Option+arrow
 * moves by word and Cmd+arrow goes to the line's end, and the editor indents
 * with Mod+[/]; those are the user's, not the browser's. Mod+Alt and Mod+Shift+
 * letter are left alone: the app's own shortcuts live there, and the browser
 * binds little to them — except Ctrl+Shift+R (reload).
 */
export function blocksBrowserDefault(e: KeyEventLike, inEditable: boolean, isMac = false): boolean {
  const k = e.key.toLowerCase();
  const m = mod(e, isMac);
  if (m && !e.altKey) {
    if (!e.shiftKey && BROWSER_MOD_KEYS.has(k)) return true;
    if (e.shiftKey && k === "r") return true;
    if (ZOOM_KEYS.has(k)) return true;
    if (e.key === "F5") return true; // hard reload
    if (!inEditable && !e.shiftKey && isMac) {
      if (k === "[" || k === "]" || e.key === "ArrowLeft" || e.key === "ArrowRight") return true;
    }
  }
  if (!m && !e.altKey && BROWSER_FN_KEYS.has(e.key)) return true;
  if (e.key === "BrowserBack" || e.key === "BrowserForward") return true;
  if (!inEditable && !isMac && e.altKey && !m && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    return true;
  }
  return false;
}

/**
 * Install the guards on a document: browser-only keys, Ctrl+wheel zoom, and
 * drag-and-drop navigation. A component that handles a drop (the grid's column
 * reorder) calls preventDefault itself and is left alone; everything else is
 * refused, so a file dropped anywhere never leaves the app. Returns the
 * uninstaller.
 */
export function installHostGuards(doc: Document, isMac = false): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (blocksBrowserDefault(e, isEditableTarget(e.target), isMac)) e.preventDefault();
  };
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  };
  const onDragOver = (e: DragEvent) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
  };
  const onDrop = (e: DragEvent) => {
    if (!e.defaultPrevented) e.preventDefault();
  };
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("wheel", onWheel, { passive: false });
  doc.addEventListener("dragover", onDragOver);
  doc.addEventListener("drop", onDrop);
  return () => {
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("wheel", onWheel);
    doc.removeEventListener("dragover", onDragOver);
    doc.removeEventListener("drop", onDrop);
  };
}
