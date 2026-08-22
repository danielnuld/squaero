// Regenerates the published screenshots: assets/media/*.png, the source the README
// and the site both copy from (docs/SITE.md).
//
// Run with `pnpm media`, which uses playwright.media.config.ts — this is a release
// chore, not part of the test suite. It needs the MySQL container up:
//
//   docker start quaero-my-test
//
// The dataset comes from e2e/support/demo.ts so the images can be reproduced. The
// previous set was shot against a database built by hand and never committed, which
// is why regenerating them meant inventing the data over again.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { installBridge } from "../support/bridge";
import { DEMO_CONNECTION, seedDemo } from "../support/demo";
import { seedBrowserState } from "../support/state";

const OUT = join(import.meta.dirname, "..", "..", "..", "assets", "media");

test.describe.configure({ mode: "serial" });

test("capture the published screenshots", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const rpc = await seedDemo();

  try {
    await installBridge(page, rpc);
    await seedBrowserState(page, { locale: "es", connections: [] });
    // The demo connection is written straight in: its name appears in the shots and
    // has to be the one the site's captions describe.
    await page.addInitScript(
      ({ conn }) => localStorage.setItem("quaero.connections", JSON.stringify([conn])),
      { conn: DEMO_CONNECTION },
    );

    const shot = async (name: string) => {
      await page.screenshot({ path: join(OUT, name), animations: "disabled" });
      console.log(`  wrote ${name}`);
    };

    /**
     * Pins the theme for the next capture.
     *
     * The preference is written and the page reloaded rather than clicking the
     * theme button: it cycles system → light → dark, so one click lands wherever
     * the previous state left it. `quaero.theme` is the stored preference
     * (utils/theme.ts).
     */
    const setTheme = (pref: "light" | "dark") =>
      page.evaluate((p) => localStorage.setItem("quaero.theme", p), pref);

    /**
     * Asserts the theme that actually got PAINTED, which is the only check worth
     * making here. The toggle's label reports the *preference*, so "Tema: sistema"
     * is visible whether the OS resolved it to light or dark — and Chromium's
     * default is light, which is how a "dark" screenshot came out light while every
     * assertion passed. `data-theme` on the root carries the resolved value.
     */
    const expectTheme = (pref: "light" | "dark") =>
      expect(page.locator("html")).toHaveAttribute("data-theme", pref);

    /** Loads the app, connects, and opens the table the captions describe. */
    const openDemoTable = async () => {
      await page.goto("/");
      await page.getByRole("button", { name: "Elegir conexión" }).click();
      await page.getByRole("button", { name: /Nueva conexión/ }).waitFor();
      await page.getByRole("button", { name: /Ventas \(demo\)/ }).click();
      await page.getByRole("button", { name: "Desconectar" }).waitFor();

      const row = (name: string) =>
        page.getByRole("treeitem", { name, exact: true }).first();
      await row("ventas").click();
      await row("Tablas").waitFor();
      await row("Tablas").click();
      await row("clientes").waitFor();
      await row("clientes").click();
      await expect(page.getByText("María López").first()).toBeVisible();

      // Bring the demo database to the top of the tree. MySQL always shows
      // information_schema, mysql, performance_schema and sys, which no caption talks
      // about; scrolling past them is what a user does too, so the framing is honest
      // rather than a tree with things removed from it.
      await page.locator('[aria-label="ventas"]').first().evaluate((el) => {
        el.scrollIntoView({ block: "start" });
      });
    };

    // 1. The empty state, which is what someone sees first — the README's hero.
    await page.goto("/");
    await setTheme("dark");
    await page.goto("/");
    await expect(page.getByText("Sin conexión")).toBeVisible();
    await expectTheme("dark");
    await page.setViewportSize({ width: 1280, height: 800 });
    await shot("screenshot-initial-dark.png");
    await page.setViewportSize({ width: 1360, height: 860 });

    // 2 & 3. The working view, in both themes. The site serves the dark one to a dark
    // browser and the light one otherwise, so both have to exist.
    await openDemoTable();
    await expectTheme("dark");
    await shot("screenshot-app-dark.png");

    await setTheme("light");
    await openDemoTable();
    await expectTheme("light");
    await shot("screenshot-app-light.png");

    await setTheme("dark");
    await openDemoTable();
    await expectTheme("dark");

    // 4-7. One shot per tool the site advertises.
    //
    // Each waits for a signal that the panel has its DATA, not merely that the tab
    // exists: the first attempt shot the ER diagram while it still said "Cargando
    // esquema…", because the data arrives over the injected bridge and there is no
    // network activity to wait on. And each panel is closed afterwards, so every
    // tool is photographed against the same two-tab baseline instead of a row of
    // tabs that grows with each shot.
    const tools: [string, string, RegExp][] = [
      // Case-insensitive on purpose: several of these labels are uppercased by CSS,
      // so the rendered text and the DOM text differ — matching the rendered form
      // finds nothing.
      ["Diagrama ER", "screenshot-er.png", /relaci[óo]n\(es\)/i],
      ["Constructor de consultas", "screenshot-builder.png", /columnas/i],
      ["Monitor de servidor", "screenshot-monitor.png", /sesi[óo]n\(es\)/i],
      ["Usuarios y permisos", "screenshot-users.png", /usuario\(s\)/i],
    ];
    for (const [button, file, ready] of tools) {
      await page
        .getByRole("toolbar", { name: "Acciones" })
        .getByRole("button", { name: button, exact: true })
        .click();
      await expect(page.getByText(ready).first()).toBeVisible({ timeout: 30_000 });
      await shot(file);
      // Escape, not a "Cerrar" button: the panels stopped printing one when the
      // tab's own ✕ became the only close (#372).
      await page.keyboard.press("Escape");
    }

    // 8. The chart view, which needs a result to chart: run a query, then chart it.
    await page.getByRole("button", { name: "Nueva consulta", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Editor SQL", exact: true });
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(
      "SELECT ciudad, COUNT(*) AS clientes FROM clientes GROUP BY ciudad ORDER BY clientes DESC",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Ejecutar", exact: true }).click();
    await expect(page.getByText("Hermosillo").first()).toBeVisible();
    await page.getByRole("button", { name: /Graficar/ }).click();
    // The chart draws into a canvas, so wait for one of its own labels. Not for the
    // chart-type names — those are <option>s inside a closed select, so they are
    // never visible.
    await expect(page.getByText(/eje \(etiquetas\)/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await shot("screenshot-charts.png");
  } finally {
    await rpc.close();
  }
});
