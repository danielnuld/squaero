// The handful of steps every published screenshot shares (issue #753): a page on
// the demo database, in one of the four styles, connected and on a known table.
//
// Everything is reached by role or accessible name, as in the e2e suite, so a
// change of layout (the M14 redesign moved every toolbar once already) costs a
// label here, not a rewrite of the capture.

import { join } from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";

import { findTheme } from "../../src/utils/themeStore";
import { newQuery, startBlank } from "./app-actions";
import { installBridge } from "./bridge";
import { DEMO_CONNECTION } from "./demo";
import type { RpcClient } from "./rpc";
import { seedBrowserState, type SeedConnection } from "./state";

/** Where the PNG sources go: the repository's assets/media/. */
export const MEDIA_DIR = join(import.meta.dirname, "..", "..", "..", "assets", "media");

/** The four built-in styles of M14 (#747), by theme id. */
export type StyleId = "nativo" | "quiet" | "editorial" | "rosa";

/**
 * The mode each style is shown in: the one the site pairs it with (docs/SITE.md):
 * B and Rosa are light, A and C dark.
 */
export const STYLE_MODE: Record<StyleId, "light" | "dark"> = {
  nativo: "light",
  quiet: "dark",
  editorial: "dark",
  rosa: "light",
};

export interface MediaOptions {
  readonly style?: StyleId;
  /** The saved connections; just the demo one unless a shot needs more. */
  readonly connections?: readonly (SeedConnection & { safeMode?: string; color?: string })[];
}

/**
 * Opens the app on the live core, in Spanish, with the demo connection saved and
 * the style pinned, and checks that the style was PAINTED.
 *
 * The style is written to storage before the page loads (`quaero.themeId` and
 * `quaero.theme`, see utils/themeStore.ts) rather than picked in Settings, so a
 * capture never depends on where the previous run left the preference.
 */
export async function openMedia(page: Page, rpc: RpcClient, opts: MediaOptions = {}): Promise<void> {
  const style = opts.style ?? "nativo";
  const mode = STYLE_MODE[style];
  await installBridge(page, rpc);
  await seedBrowserState(page, { locale: "es", connections: [] });
  await page.addInitScript(
    ({ conns, id, m }) => {
      localStorage.setItem("quaero.connections", JSON.stringify(conns));
      localStorage.setItem("quaero.themeId", id);
      localStorage.setItem("quaero.theme", m);
    },
    { conns: opts.connections ?? [DEMO_CONNECTION], id: style, m: mode },
  );
  await page.goto("/");
  await startBlank(page);
  await expectStyle(page, style);
}

/** "#rrggbb" → "rgb(r, g, b)", the form getComputedStyle reports. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * Asserts the style that got painted, not the one asked for: the resolved mode
 * on the root, and the page background and accent equal to that theme's tokens.
 * A light capture that came out dark (it happened once, with every label
 * claiming otherwise) fails here instead of reaching the site.
 */
export async function expectStyle(page: Page, style: StyleId): Promise<void> {
  const mode = STYLE_MODE[style];
  const tokens = findTheme(style, [])[mode];
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  await expect(page.locator("body")).toHaveCSS("background-color", rgb(tokens.bg));
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase(),
  );
  expect(accent).toBe(tokens.accent.toLowerCase());
}

/** A tree row by its exact name. */
export const treeRow = (page: Page, name: string): Locator =>
  page.getByRole("treeitem", { name, exact: true }).first();

/** Opens the demo connection from the saved list, as a user would. */
export async function connectDemo(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Conectar a una base de datos…" }).first().click();
  await page
    .getByRole("dialog", { name: "Buscar una conexión" })
    .getByRole("button", { name: /Ventas \(demo\)/ })
    .click();
  await treeRow(page, "ventas").waitFor();
}

/** Connects and opens `table` of the demo database in a data tab. */
export async function openDemoTable(page: Page, table = "clientes", firstValue = "María López"): Promise<void> {
  await connectDemo(page);
  await treeRow(page, "ventas").click();
  await treeRow(page, "Tablas").click();
  await treeRow(page, table).click();
  await expect(page.getByRole("grid").getByText(firstValue).first()).toBeVisible();
}

/** The SQL editor of the active query tab. */
export const sqlEditor = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Editor SQL", exact: true });

/** Replaces the editor's text. Escape closes the completion popup typing opens. */
export async function typeSql(page: Page, sql: string): Promise<void> {
  await sqlEditor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(sql);
  await page.keyboard.press("Escape");
}

/**
 * Runs what the editor holds. By the run button's name, which has been
 * «Ejecutar» and is «Ejecutar sentencia» since the editor redesign (#691);
 * both are accepted so the capture survives a relabel.
 */
export async function runEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Ejecutar( sentencia)?$/ }).first().click();
}

/**
 * Types `sql` into the query tab on screen and runs it; waits for `ready` in the
 * grid. The app starts with no tab (#694): with no editor showing, one is opened.
 */
export async function runQuery(page: Page, sql: string, ready: string): Promise<void> {
  if (!(await sqlEditor(page).isVisible())) await newQuery(page);
  await typeSql(page, sql);
  await runEditor(page);
  await expect(page.getByRole("grid").getByText(ready, { exact: true }).first()).toBeVisible();
}

/** Opens one of the connection's tools from its Herramientas menu. */
export async function openTool(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Herramientas", exact: true }).first().click();
  await page.getByRole("menu").getByRole("menuitem", { name, exact: true }).click();
}

/**
 * Writes `assets/media/<name>.png`. The pointer is parked first, so no tooltip or
 * hover state the shot did not ask for ends up in the image.
 */
export async function shot(page: Page, name: string, opts: { keepPointer?: boolean } = {}): Promise<void> {
  if (!opts.keepPointer) await page.mouse.move(-10, -10);
  await page.screenshot({ path: join(MEDIA_DIR, `${name}.png`), animations: "disabled", caret: "hide" });
  console.log(`  wrote ${name}.png`);
}
