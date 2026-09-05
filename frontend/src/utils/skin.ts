// Colour theme selection ("skin"), stamped on the root as `data-skin` and
// styled in styles.css.
//
// Two kinds live here, and the difference is the whole design (issue #473):
//
//   - An ACCENT skin swaps the accent hue and nothing else, so it layers over
//     either light or dark. "indigo" is the Squaero brand default (M10.8);
//     "blue" is an alternate professional blue.
//   - A DARK theme brings its own surfaces — background, text, borders — and
//     therefore has no light variant. While one is active the light/dark
//     preference is held at dark: a half-made light version of Terminal would
//     be worse than not offering one, and the preference is remembered, so
//     going back to an accent skin restores what the user had chosen.
//
// App applies the choice on the root and persists it.

export type SkinPref = "indigo" | "blue" | "ciruela" | "pizarra" | "terminal";

/** The skins in picker order. `dark` marks the ones that own their surfaces. */
export const SKINS: { value: SkinPref; label: string; dark: boolean }[] = [
  { value: "indigo", label: "Squaero (índigo)", dark: false },
  { value: "blue", label: "Azul", dark: false },
  { value: "ciruela", label: "Ciruela", dark: true },
  { value: "pizarra", label: "Pizarra", dark: true },
  { value: "terminal", label: "Terminal", dark: true },
];

/** localStorage key for the persisted skin. */
export const SKIN_KEY = "quaero.skin";

const isSkin = (v: unknown): v is SkinPref => SKINS.some((s) => s.value === v);

/** True for a skin that defines its own dark surfaces (no light variant). */
export function isDarkOnly(skin: SkinPref): boolean {
  return SKINS.find((s) => s.value === skin)?.dark ?? false;
}

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
  const found = SKINS.find((s) => s.value === skin);
  return `Estilo: ${found?.label ?? "Squaero (índigo)"}`;
}

/**
 * Stamp the skin onto a root element's `data-skin` attribute. Pure w.r.t.
 * everything except that one attribute write, so it is easy to drive from a
 * test with a detached element. The attribute is always set (even for the
 * default) so toggling back to indigo cleanly removes the other skin's
 * overrides.
 */
export function applySkin(
  skin: SkinPref,
  root: Pick<HTMLElement, "setAttribute">,
): void {
  root.setAttribute("data-skin", skin);
}
