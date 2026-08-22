// The navigation band: the launcher, the tool strip, and the names they keep.
//
// The ribbon of twelve buttons this replaced (#386) had one property worth not
// losing: every destination was reachable by an accessible name, and the icons
// were decorative SVGs rather than emoji that announce themselves. The strip is
// icon-ONLY now, so the name has nowhere to hide — it comes from aria-label, and
// a missing one costs a screen-reader user the button entirely while a sighted
// user notices nothing.

import { connect } from "./support/app-actions";
import { describeEngine, expect, test } from "./support/fixtures";

/** The nine tools in the strip, by the accessible name a user hears. */
const TOOLS = [
  "Monitor de servidor",
  "Consultas lentas",
  "Usuarios y permisos",
  "Diagrama ER",
  "Constructor de consultas",
  "Procedimientos y funciones",
  "Triggers y eventos",
  "Notebook SQL",
  "Snippets",
];

describeEngine("sqlite", () => {
  test("every tool in the strip has a name and an icon, and ⋯ folds it away", async ({
    app,
  }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    const strip = page.getByRole("toolbar", { name: "Acciones" });
    // Shown by default: it is how someone finds out these nine exist at all.
    await expect(strip).toBeVisible();

    for (const name of TOOLS) {
      const button = strip.getByRole("button", { name, exact: true });
      await expect(button, `${name} is reachable by name`).toBeVisible();
      await expect(button).toBeEnabled();
      // Vector art, not a character: an emoji could not take the strip's colour.
      await expect(button.locator("svg")).toHaveCount(1);
      // If the icon were exposed, it would land in the accessible name too and
      // the exact match above would already have failed.
      await expect(button.locator("svg[aria-hidden='true']")).toHaveCount(1);
    }

    // No stragglers: if a tool is added, this test should have to say so.
    await expect(strip.getByRole("button")).toHaveCount(TOOLS.length);

    // And it folds away for anyone who wants the 40 px back.
    await page.getByRole("button", { name: "Barra de herramientas", exact: true }).click();
    await expect(strip).toBeHidden();
  });

  test("Snippets opens its panel from the strip", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    await page
      .getByRole("toolbar", { name: "Acciones" })
      .getByRole("button", { name: "Snippets", exact: true })
      .click();

    // It opens as a tab, the same one the editor's own button and Ctrl+J reach,
    // so they focus a single panel rather than piling up duplicates.
    await expect(page.getByRole("button", { name: /Cerrar pestaña/ }).nth(1)).toBeVisible();
    await expect(page.getByText("Snippets").first()).toBeVisible();
  });

  test("the launcher opens the palette the strip's tools also live in", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    // Named by its visible label, not by the title: the label is what a screen
    // reader reads and what a sighted user clicks.
    await page.getByRole("button", { name: /Buscar o ejecutar/ }).click();

    const palette = page.getByRole("dialog", { name: "Paleta de comandos" });
    await expect(palette).toBeVisible();
    // Every tool the ribbon used to show is in here, which is what makes taking
    // the ribbon away honest rather than a removal.
    for (const name of TOOLS) {
      await expect(palette.getByText(name, { exact: true }).first()).toBeVisible();
    }
  });

  test("the tree's tools menu shows the same icons, not emoji", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    // Exact: the strip's own toggle is "Barra de herramientas", which a substring
    // match would also find.
    await page.getByRole("button", { name: "Herramientas", exact: true }).click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    // The same nine tools as the strip, each with its own icon. The exact-name
    // match is what proves the emoji is gone: the label used to have one glued in
    // front of it, so the accessible name was "🖥️  Monitor de servidor" — a screen
    // reader read the decoration aloud and this match would fail.
    for (const name of TOOLS) {
      const item = menu.getByRole("menuitem", { name, exact: true });
      await expect(item, `${name} is in the tools menu`).toBeVisible();
      await expect(item.locator("svg")).toHaveCount(1);
    }
  });

  test("the tools stay disabled until a connection is open", async ({ app }) => {
    const { page } = app;
    await app.open();

    const strip = page.getByRole("toolbar", { name: "Acciones" });
    for (const name of TOOLS) {
      await expect(
        strip.getByRole("button", { name, exact: true }),
        `${name} is disabled with no connection`,
      ).toBeDisabled();
    }
  });
});
