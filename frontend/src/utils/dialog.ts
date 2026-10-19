// The one dialog pattern (issue #692): the pure half. Which operating system
// the app runs on decides the order of the action row, Enter decides whether it
// may press the primary button, and Tab is kept inside the dialog.
//
// Windows puts the affirmative action first ([Guardar] [Cancelar]); macOS and
// GNOME put Cancel first and the action last ([Cancelar] [Guardar]), see audit
// A-21 / R-08. Everything here is pure so the rules are unit-tested; the
// component (components/Dialog.tsx) only wires them to the DOM.

export type Os = "windows" | "macos" | "linux";

/**
 * The OS from `navigator.platform` / `navigator.userAgent`, read the way the
 * app already detects macOS (App.tsx `isMac`). Unknown → Windows, the platform
 * most users run.
 */
export function osFromPlatform(platform: string | null | undefined): Os {
  const p = platform ?? "";
  if (/mac|iphone|ipad/i.test(p)) return "macos";
  if (/win/i.test(p)) return "windows";
  if (/linux|x11|bsd|cros/i.test(p)) return "linux";
  return "windows";
}

/** The OS the webview runs on. */
export function currentOs(): Os {
  if (typeof navigator === "undefined") return "windows";
  return osFromPlatform(navigator.platform || navigator.userAgent);
}

/**
 * The action row in the OS order. `actions` come in the Windows order — the
 * primary first, Cancel last ([Guardar y conectar] [Guardar] [Cancelar]);
 * macOS and Linux read it backwards, Cancel first and the primary last. In the
 * DOM as well, not only on screen, so Tab walks the buttons in the order seen.
 */
export function orderActions<T>(os: Os, actions: readonly T[]): T[] {
  return os === "windows" ? [...actions] : [...actions].reverse();
}

/** The parts of a focused element Enter cares about. */
export interface EnterTarget {
  tagName: string;
  type?: string;
}

/**
 * Whether Enter, pressed on `target`, presses the dialog's primary button.
 *
 * Only from a field you type into (or with focus on nothing in particular): a
 * focused button, link, select or dropdown already does its own thing with
 * Enter — a focused Cancel must cancel, not confirm — a textarea takes it as a
 * new line, and a grid or list inside the dialog uses it to move. Never in a
 * destructive dialog (R-08: Intro never triggers the danger button).
 */
export function enterPressesPrimary(target: EnterTarget | null, danger: boolean): boolean {
  if (danger) return false;
  if (!target) return true;
  if (target.tagName.toUpperCase() !== "INPUT") return false;
  const type = (target.type ?? "text").toLowerCase();
  return !["button", "submit", "reset", "file", "image", "color", "range"].includes(type);
}

/**
 * Where Tab goes inside a focus trap: the element to focus, or null to let the
 * browser move focus itself (it stays inside without help). `active` outside
 * the list pulls focus back to the first element.
 */
export function trapTarget<T>(focusables: readonly T[], active: T | null, backwards: boolean): T | null {
  if (focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const i = active === null ? -1 : focusables.indexOf(active);
  if (i === -1) return backwards ? last : first;
  if (backwards && i === 0) return last;
  if (!backwards && i === focusables.length - 1) return first;
  return null;
}

/**
 * Whether a typed confirmation matches the name it asks for. Exact text, only
 * the surrounding spaces forgiven: «Clientes» is not «clientes» in an engine
 * that tells them apart.
 */
export function typedNameMatches(typed: string, name: string): boolean {
  return name !== "" && typed.trim() === name;
}
