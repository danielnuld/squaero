// Reference screenshots of the main screens, light and dark (issue #697).
//
// Each test loads the interface fresh, walks to one screen and compares the whole
// viewport with the committed baseline in __screenshots__/. The baselines are
// Linux pixels — see playwright.visual.config.ts for why — so elsewhere this
// skips rather than failing on fonts. QUAERO_VISUAL_ANY_OS=1 runs it anyway, for
// proving the walk itself works on a laptop; what it writes is not a baseline.
//
// Determinism, in one place:
//   - fixed viewport, scale, zone and locale  → the config
//   - no transitions, no caret                 → the config
//   - fixed data                               → the SQLite fixture every e2e test uses
//   - frozen time                              → page.clock, below: Date, timers and
//     performance.now stand still at FROZEN, so the run toast says "0 ms" and
//     never times out, and the status bar's duration is always the same.
//   - theme pinned by preference, not by click → the toggle cycles system → light →
//     dark, so one click lands wherever the last run left it.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { connect, newQuery, openFixtureTable, runSql } from "../support/app-actions";
import { describeEngine, expect, test } from "../support/fixtures";

type Theme = "light" | "dark";

/** A Thursday mid-morning: formatClock prints it as "10:30". */
const FROZEN = new Date("2026-01-15T10:30:00-07:00");

const BASELINES = join(import.meta.dirname, "__screenshots__");

const onLinux = process.platform === "linux" || process.env.QUAERO_VISUAL_ANY_OS === "1";

/** True when the folder holds no PNG at all: the baselines were never generated. */
function noBaselines(): boolean {
  return !existsSync(BASELINES) || !readdirSync(BASELINES).some((f) => f.endsWith(".png"));
}

/** The theme the page PAINTED, which the toggle's label does not report. */
const expectTheme = (page: Page, theme: Theme) =>
  expect(page.locator("html")).toHaveAttribute("data-theme", theme);

for (const theme of ["light", "dark"] as const) {
  describeEngine("sqlite", () => {
    test.describe(theme, () => {
      test.skip(
        !onLinux,
        "baselines are Linux pixels; run `pnpm visual` in CI or in the Playwright container (e2e/README.md)",
      );

      test.beforeAll(() => {
        // Playwright would write the missing files and fail each test with "A
        // snapshot doesn't exist", which is right but does not say what to do.
        // `missing` is the default mode; --update-snapshots makes it `changed`/`all`.
        const mode = test.info().config.updateSnapshots;
        if (noBaselines() && (mode === "missing" || mode === "none")) {
          throw new Error(
            `no visual baselines in ${BASELINES} — run the "Visual baselines" workflow ` +
              "(Actions → Visual baselines → Run workflow) or `pnpm visual:update` in the " +
              "Playwright container; see frontend/e2e/README.md",
          );
        }
      });

      // After `app`, so these init scripts land after seedBrowserState has cleared
      // the theme key. Every navigation, which is harmless: the theme never changes
      // within a test.
      test.beforeEach(async ({ app }) => {
        await app.page.addInitScript((t) => localStorage.setItem("quaero.theme", t), theme);
        await app.page.clock.install({ time: FROZEN });
        await app.page.clock.pauseAt(FROZEN);
      });

      const shot = (page: Page, name: string) =>
        expect(page).toHaveScreenshot(`${name}-${theme}.png`);

      test("welcome: nothing connected", async ({ app }) => {
        const { page } = app;
        await app.open();
        await expect(page.getByText("Sin conexión").first()).toBeVisible();
        await expectTheme(page, theme);
        await shot(page, "welcome");
      });

      test("connection search and the new-connection form", async ({ app }) => {
        const { page } = app;
        await app.open();
        await page.getByRole("button", { name: "Conectar a una base de datos…" }).click();
        const search = page.getByRole("dialog", { name: "Buscar una conexión" });
        await expect(search.getByRole("button", { name: /E2E SQLite/ })).toBeVisible();
        await expectTheme(page, theme);
        await shot(page, "connection-search");

        await search.getByRole("button", { name: /Nueva conexión/ }).click();
        const form = page.getByRole("region", { name: /conexión/ });
        await form.getByRole("radio", { name: /SQLite/ }).click();
        await expect(form.getByRole("textbox", { name: /^Nombre/ })).toBeVisible();
        await shot(page, "connection-form");
      });

      test("object tree and table grid", async ({ app }) => {
        const { page } = app;
        await app.open();
        await connect(app);
        await openFixtureTable(app);
        await expectTheme(page, theme);
        await shot(page, "explorer-grid");
      });

      test("SQL editor with a result and the status bar", async ({ app }) => {
        const { page } = app;
        await app.open();
        await connect(app);
        await newQuery(page);
        await runSql(
          page,
          "SELECT id, nombre, length(nombre) AS largo FROM e2e_items WHERE id < 20 ORDER BY id",
        );
        await expect(page.getByText("Cd. Obregón", { exact: true })).toBeVisible();
        // No toast for a result on screen (issue #693): the status bar says it.
        await expect(page.getByRole("status", { name: "Barra de estado" })).toContainText("12 filas");
        await expectTheme(page, theme);
        await shot(page, "editor-result");
      });

      test("settings", async ({ app }) => {
        const { page } = app;
        await app.open();
        await page.getByRole("button", { name: "Ajustes" }).click();
        // The grid category: the one with the most to look at (#684 split the panel).
        await page.locator(".settings-nav-item", { hasText: "Rejilla" }).click();
        await expect(page.getByText("Colorear los datos por tipo")).toBeVisible();
        await expectTheme(page, theme);
        await shot(page, "settings");
      });

      test("confirm dialog before a DROP", async ({ app }) => {
        const { page } = app;
        await app.open();
        await connect(app);
        await openFixtureTable(app);
        await page
          .getByRole("treeitem", { name: "e2e_items", exact: true })
          .first()
          .click({ button: "right" });
        await page.getByRole("menu").getByRole("menuitem", { name: "Eliminar…" }).click();
        const dialog = page.getByRole("alertdialog", { name: /Eliminar/ });
        await expect(dialog.getByText("DROP TABLE")).toBeVisible();
        await expectTheme(page, theme);
        await shot(page, "confirm-dialog");
        await dialog.getByRole("button", { name: "Cancelar" }).click();
      });
    });
  });
}
