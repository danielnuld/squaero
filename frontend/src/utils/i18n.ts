// Internationalization (issue: English support). A tiny, dependency-free i18n
// built on a Solid signal so `t()` re-renders every component when the locale
// changes — no page reload. Spanish (es) is the base catalog; English (en)
// mirrors its keys. Resolution: current locale → es → the key itself, so an
// untranslated string degrades to Spanish, never to a blank.
//
// The pure parts (detectLocale, translate, load/save) are unit-tested; the
// reactive `locale`/`t`/`setLocale` layer is a module singleton, like a store.

import { createSignal } from "solid-js";
import { resolveStore, type KeyValueStore } from "./kvStore";
import { es } from "./messages/es";
import { en } from "./messages/en";

export type Locale = "es" | "en";

/** Supported locales, in menu order. */
export const LOCALES: Locale[] = ["es", "en"];

/** localStorage key for the persisted preference. */
export const LOCALE_KEY = "quaero.locale";

const CATALOGS: Record<Locale, Record<string, string>> = { es, en };

export const isLocale = (v: unknown): v is Locale => v === "es" || v === "en";

/**
 * Map a BCP-47 language tag (e.g. `navigator.language`) to a supported locale.
 * English tags ("en", "en-US", …) → en; everything else falls back to es.
 */
export function detectLocale(lang: string | null | undefined): Locale {
  return typeof lang === "string" && lang.toLowerCase().startsWith("en") ? "en" : "es";
}

/** Read the saved locale, or null when unset/invalid. Never throws. */
export function loadLocale(store: Pick<KeyValueStore, "getItem">): Locale | null {
  try {
    const v = store.getItem(LOCALE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/** Persist the locale. Best-effort; a failing/absent store is ignored. */
export function saveLocale(l: Locale, store: Pick<KeyValueStore, "setItem">): void {
  try {
    store.setItem(LOCALE_KEY, l);
  } catch {
    /* storage unavailable (private mode / no webview persistence): ignore */
  }
}

/** Fill `{name}` placeholders from params; unknown placeholders are left intact. */
function interpolate(msg: string, params: Record<string, string | number>): string {
  return msg.replace(/\{(\w+)\}/g, (whole, name) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Pure translation: look up `key` in `locale`, then in the es base, then return
 * the key. Interpolates `{name}` placeholders from `params`.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const msg = CATALOGS[locale]?.[key] ?? CATALOGS.es[key] ?? key;
  return params ? interpolate(msg, params) : msg;
}

/** The initial locale: a saved preference wins; otherwise detect from the OS. */
function initialLocale(): Locale {
  const saved = loadLocale(resolveStore());
  if (saved) return saved;
  const nav = typeof navigator !== "undefined" ? navigator.language : undefined;
  return detectLocale(nav);
}

const [locale, setLocaleSignal] = createSignal<Locale>(initialLocale());

/** Reactive accessor for the active locale. */
export { locale };

// Keep <html lang> in sync from the start (a11y / SEO), guarded for non-DOM.
if (typeof document !== "undefined") document.documentElement.lang = locale();

/** Switch locale: updates every `t()` reactively, persists, stamps <html lang>. */
export function setLocale(l: Locale): void {
  setLocaleSignal(l);
  saveLocale(l, resolveStore());
  if (typeof document !== "undefined") document.documentElement.lang = l;
}

/** Reactive translation. Call inside JSX; re-renders when the locale changes. */
export function t(key: string, params?: Record<string, string | number>): string {
  return translate(locale(), key, params);
}
