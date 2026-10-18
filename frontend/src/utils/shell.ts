// The native window's own chrome (issue #685): its title and the theme its
// title bar follows. The shell binds `quaeroSetTitle` and `quaeroSetTheme`
// (see app/src/main.cc); in a plain browser (pnpm dev) they are absent and
// only document.title changes. Not IPC: nothing here reaches the core.

import type { ResolvedTheme } from "./theme";

interface ShellHost {
  quaeroSetTitle?: (title: string) => unknown;
  quaeroSetTheme?: (theme: ResolvedTheme) => unknown;
}

/** The product name, the title's constant last part. */
export const APP_NAME = "Squaero";

/**
 * The window title for what is on screen: "orders — prod-db — Squaero" with a
 * tab and a connection, "prod-db — Squaero" with a connection alone, "orders —
 * Squaero" with a tab alone, and just "Squaero" with neither. Blank parts count
 * as absent, so a connection named "  " never leaves an orphan dash.
 */
export function windowTitle(
  tabTitle: string | null | undefined,
  connectionName: string | null | undefined,
): string {
  const parts = [tabTitle, connectionName]
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "");
  parts.push(APP_NAME);
  return parts.join(" — ");
}

/** Set the document title and, inside the shell, the native window's. */
export function setShellTitle(title: string): void {
  if (typeof document !== "undefined") document.title = title;
  (globalThis as ShellHost).quaeroSetTitle?.(title);
}

/** Tell the shell which theme the UI resolved, so its title bar matches. */
export function setShellTheme(theme: ResolvedTheme): void {
  (globalThis as ShellHost).quaeroSetTheme?.(theme);
}
