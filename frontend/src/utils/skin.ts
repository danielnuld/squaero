// Accent "skin" selection. Orthogonal to the light/dark theme (theme.ts): the
// skin only swaps the accent hue, so it layers over either theme. "indigo" is
// the Quaero brand default (M10.8); "blue" is an alternate professional blue for
// users who prefer it. The CSS lives in styles.css keyed on the `data-skin`
// attribute; App applies it on the root and persists the preference.

export type SkinPref = "indigo" | "blue";

/** localStorage key for the persisted skin. */
export const SKIN_KEY = "quaero.skin";

const isSkin = (v: unknown): v is SkinPref => v === "indigo" || v === "blue";

/** Read the saved skin, defaulting to the brand "indigo". Never throws. */
export function loadSkin(storage?: Pick<Storage, "getItem">): SkinPref {
  try {
    const raw = storage?.getItem(SKIN_KEY);
    return isSkin(raw) ? raw : "indigo";
  } catch {
    return "indigo";
  }
}

/** Persist the skin. Best-effort; a failing/absent storage is ignored. */
export function saveSkin(skin: SkinPref, storage?: Pick<Storage, "setItem">): void {
  try {
    storage?.setItem(SKIN_KEY, skin);
  } catch {
    /* storage unavailable (private mode / no webview persistence): ignore */
  }
}

/** Short label for the skin control. */
export function skinLabel(skin: SkinPref): string {
  return skin === "blue" ? "Estilo: Azul" : "Estilo: Quaero (índigo)";
}

/**
 * Stamp the skin onto a root element's `data-skin` attribute. Pure w.r.t.
 * everything except that one attribute write, so it is easy to drive from a
 * test with a detached element. The attribute is always set (even for the
 * default) so toggling back to indigo cleanly removes the blue overrides.
 */
export function applySkin(
  skin: SkinPref,
  root: Pick<HTMLElement, "setAttribute">,
): void {
  root.setAttribute("data-skin", skin);
}
