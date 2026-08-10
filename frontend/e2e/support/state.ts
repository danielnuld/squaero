// Client-side state the interface reads on load, pinned so a test never inherits
// what a previous run — or a real user on this machine — left behind.
//
// The keys are the ones src/utils/* persist. `quaero.locale` matters most: the
// language is autodetected and `es` is the base catalogue, so without pinning it,
// every text assertion would depend on the machine's language.

import type { Page } from "@playwright/test";
import type { EngineSpec } from "./engines";

export type Locale = "es" | "en";

/** Every key the frontend persists, so "known state" means all of it. */
const KEYS = [
  "quaero.connections",
  "quaero.locale",
  "quaero.history",
  "quaero.history.limit",
  "quaero.snippets",
  "quaero.notebooks",
  "quaero.settings",
  "quaero.theme",
  "quaero.skin",
  "quaero.groups.collapsed",
  "quaero.update.skip",
] as const;

export interface SeedOptions {
  /** Connections to pre-save. Empty means the user has none yet. */
  readonly connections?: readonly EngineSpec[];
  readonly locale?: Locale;
}

/**
 * The saved-connection shape importConnections/parseConnections accept: driver at
 * the top level and every param a string (non-string params are dropped).
 */
function connectionRecord(engine: EngineSpec): Record<string, unknown> {
  return {
    id: `e2e-${engine.name}`,
    name: engine.label,
    driver: engine.driver,
    params: engine.dsn,
  };
}

export async function seedBrowserState(
  page: Page,
  options: SeedOptions = {},
): Promise<void> {
  const connections = (options.connections ?? []).map(connectionRecord);
  const locale: Locale = options.locale ?? "es";

  // Only on the FIRST load of the page. addInitScript runs on every navigation, so
  // seeding unconditionally meant a page.reload() wiped whatever the test had just
  // created — which quietly turned "does this survive a reload?" into a test of the
  // harness deleting it. The sentinel lives in sessionStorage, which survives a
  // reload within the tab and dies with it, so the next test still starts clean.
  await page.addInitScript(
    ({ keys, connections: conns, locale: loc, sentinel }) => {
      try {
        if (sessionStorage.getItem(sentinel) !== null) {
          return;
        }
        sessionStorage.setItem(sentinel, "1");
        for (const key of keys) {
          localStorage.removeItem(key);
        }
        localStorage.setItem("quaero.locale", loc);
        if (conns.length > 0) {
          localStorage.setItem("quaero.connections", JSON.stringify(conns));
        }
      } catch {
        // Some webviews expose localStorage and throw on access; the app tolerates
        // that with an in-memory store, so a test must not die on it either.
      }
    },
    { keys: KEYS, connections, locale, sentinel: "quaero.e2e.seeded" },
  );
}
