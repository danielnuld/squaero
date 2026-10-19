// The app's own title bar (issue #688): which variant to draw for the OS and
// the shell's state, the menu's access keys, and the `quaeroWindow` binding
// the shell (app/src/main.cc, macos.mm) offers on Windows and macOS. Linux,
// and a plain browser, have no binding: the system draws the window frame and
// the bar is drawn below it, without window buttons. Not IPC: nothing here
// reaches the core.

export type Os = "windows" | "macos" | "linux";

/** What the shell reports about its window (titlebar.h, quaero_window_state_json). */
export interface WindowState {
  os: Os;
  /** The app's own title bar replaces the system's. */
  frameless: boolean;
  maximized: boolean;
  /** "mica": a see-through page shows the Windows 11 backdrop. */
  backdrop: "mica" | "none";
}

/** The OS from navigator.platform / userAgent text. Anything unknown is Linux. */
export function detectOs(platform: string): Os {
  if (/mac|iphone|ipad/i.test(platform)) return "macos";
  if (/win/i.test(platform)) return "windows";
  return "linux";
}

/** A state the shell sent, or null when it is not one. */
export function parseWindowState(value: unknown): WindowState | null {
  if (typeof value === "string") {
    try {
      return parseWindowState(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.os !== "windows" && v.os !== "macos" && v.os !== "linux") return null;
  if (typeof v.frameless !== "boolean" || typeof v.maximized !== "boolean") return null;
  return {
    os: v.os,
    frameless: v.frameless,
    maximized: v.maximized,
    backdrop: v.backdrop === "mica" ? "mica" : "none",
  };
}

/** Which pieces the bar draws. */
export interface TitleBarLayout {
  os: Os;
  /** The app menu in the bar (Windows, own bar, the menu setting on). */
  menu: boolean;
  /** Minimize / maximize / close drawn by the UI (Windows, own bar). */
  windowButtons: boolean;
  /** Room on the left for the traffic lights (macOS, own bar). */
  trafficLights: boolean;
  /** A press on the empty bar moves the window (any own bar). */
  draggable: boolean;
}

/**
 * The variant for `os` and the shell's `state` (null: no shell binding — Linux
 * or a browser — so the system frame stays). `menu` is the user's menu-bar
 * setting; with the system frame the shell's native menu bar carries it.
 */
export function titleBarLayout(
  os: Os,
  state: WindowState | null,
  menu: boolean,
): TitleBarLayout {
  const own = !!state?.frameless;
  return {
    os,
    menu: own && os === "windows" && menu,
    windowButtons: own && os === "windows",
    trafficLights: own && os === "macos",
    draggable: own,
  };
}

/**
 * Each label's access key — the letter Alt+key opens it with, underlined — as
 * an index into the label, or -1. Greedy, left to right: a label takes its
 * first letter no earlier label took ("Archivo, Editar, Ver, Consulta,
 * Herramientas, Ventana, Ayuda" -> A E V C H n y), the way Windows menus do.
 */
export function accessKeys(labels: readonly string[]): number[] {
  const taken = new Set<string>();
  return labels.map((label) => {
    for (let i = 0; i < label.length; i++) {
      const ch = label[i].toLocaleLowerCase();
      if (!/\p{L}|\p{N}/u.test(ch) || taken.has(ch)) continue;
      taken.add(ch);
      return i;
    }
    return -1;
  });
}

/** The menu whose access key is `key` (case-insensitive), or -1. */
export function menuForKey(
  labels: readonly string[],
  keys: readonly number[],
  key: string,
): number {
  const k = key.toLocaleLowerCase();
  return labels.findIndex((label, i) => keys[i] >= 0 && label[keys[i]].toLocaleLowerCase() === k);
}

// --- The shell binding ---------------------------------------------------------

/** The event the shell dispatches on `window`: a state, or `{maxHover}`. */
export const WINDOW_EVENT = "quaero-window";

interface ShellHost {
  quaeroWindow?: (command: string, ...args: unknown[]) => Promise<unknown>;
}

/** True inside a shell that lets the UI draw the title bar (Windows, macOS). */
export function hasWindowBinding(): boolean {
  return typeof (globalThis as ShellHost).quaeroWindow === "function";
}

/**
 * Send a command to the shell (titlebar.h lists them) and get its state back;
 * null without a shell, or when the shell refused the command.
 */
export async function windowCommand(command: string, ...args: unknown[]): Promise<WindowState | null> {
  const fn = (globalThis as ShellHost).quaeroWindow;
  if (typeof fn !== "function") return null;
  try {
    return parseWindowState(await fn(command, ...args));
  } catch {
    return null;
  }
}

/**
 * Run `onState` with each state the shell pushes (the window maximized or
 * restored) and `onMaxHover` with the pointer entering/leaving the maximize
 * button (Windows: the shell's Snap layouts helper sits over it, so the page
 * never sees that pointer itself). Returns the uninstaller.
 */
export function onWindowEvent(
  target: EventTarget,
  onState: (s: WindowState) => void,
  onMaxHover: (hover: boolean) => void,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail === "object" && typeof detail.maxHover === "boolean") {
      onMaxHover(detail.maxHover);
      return;
    }
    const s = parseWindowState(detail);
    if (s) onState(s);
  };
  target.addEventListener(WINDOW_EVENT, listener);
  return () => target.removeEventListener(WINDOW_EVENT, listener);
}
