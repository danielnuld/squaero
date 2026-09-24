// The pure half of i18n (i18n.ts): the catalogs and the lookup, with no Solid
// and no storage, so squaero-logic.js can carry them to the iPhone app (#576).
// Resolution: locale → es → the key itself.

import { es } from "./messages/es";
import { en } from "./messages/en";

export type Locale = "es" | "en";

/** Supported locales, in menu order. */
export const LOCALES: Locale[] = ["es", "en"];

const CATALOGS: Record<Locale, Record<string, string>> = { es, en };

export const isLocale = (v: unknown): v is Locale => v === "es" || v === "en";

/**
 * Map a BCP-47 language tag (e.g. `navigator.language`) to a supported locale.
 * English tags ("en", "en-US", …) → en; everything else falls back to es.
 */
export function detectLocale(lang: string | null | undefined): Locale {
  return typeof lang === "string" && lang.toLowerCase().startsWith("en") ? "en" : "es";
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
