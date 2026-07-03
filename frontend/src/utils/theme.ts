// Light/dark theme selection (issue #42). Pure logic here; the CSS lives in
// styles.css keyed on the `data-theme` attribute, and App wires the toggle +
// applies the resolved theme to the document root.
//
// The user picks one of three preferences; "system" follows the OS setting and
// keeps tracking it live. The preference persists in localStorage; the resolved
// theme (never "system") is what gets stamped on the root.

export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/** localStorage key for the persisted preference. */
export const THEME_KEY = "quaero.theme";

/** Cycle order for the toggle: system → light → dark → system. */
const ORDER: ThemePref[] = ["system", "light", "dark"];

/** Next preference in the toggle cycle. */
export function nextTheme(pref: ThemePref): ThemePref {
  const i = ORDER.indexOf(pref);
  return ORDER[(i + 1) % ORDER.length];
}

/** Resolve a preference to the concrete theme to apply. */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

/** Short label for the toggle control, including the effective theme. */
export function themeLabel(pref: ThemePref): string {
  switch (pref) {
    case "light":
      return "Tema: claro";
    case "dark":
      return "Tema: oscuro";
    default:
      return "Tema: sistema";
  }
}

/** A single glyph cueing the current preference (for a compact toggle). */
export function themeIcon(pref: ThemePref): string {
  switch (pref) {
    case "light":
      return "☀";
    case "dark":
      return "☾";
    default:
      return "◐";
  }
}

const isPref = (v: unknown): v is ThemePref =>
  v === "system" || v === "light" || v === "dark";

/** Read the saved preference, defaulting to "system". Never throws. */
export function loadTheme(storage?: Pick<Storage, "getItem">): ThemePref {
  try {
    const raw = storage?.getItem(THEME_KEY);
    return isPref(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/** Persist the preference. Best-effort; a failing/absent storage is ignored. */
export function saveTheme(pref: ThemePref, storage?: Pick<Storage, "setItem">): void {
  try {
    storage?.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable (private mode / no webview persistence): ignore */
  }
}

/**
 * Stamp the resolved theme onto a root element's `data-theme` attribute and
 * return it. Pure w.r.t. everything except that one attribute write, so it is
 * easy to drive from a test with a detached element.
 */
export function applyTheme(
  pref: ThemePref,
  root: Pick<HTMLElement, "setAttribute">,
  systemPrefersDark: boolean,
): ResolvedTheme {
  const resolved = resolveTheme(pref, systemPrefersDark);
  root.setAttribute("data-theme", resolved);
  return resolved;
}
