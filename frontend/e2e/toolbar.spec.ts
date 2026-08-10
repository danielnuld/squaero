// The action ribbon: twelve buttons, each still nameable, and Snippets among them.
//
// The icons are decorative SVGs now instead of emoji, which is exactly the change
// that could have cost every button its accessible name — the name comes from the
// visible label, and an icon that started announcing itself, or a label that got
// dropped in favour of the glyph, would break screen-reader use without changing
// anything a sighted user notices.

import { connect } from "./support/app-actions";
import { describeEngine, expect, test } from "./support/fixtures";

/** Every ribbon button, by the accessible name a user hears. */
const RIBBON = [
  "Consulta",
  "Tabla",
  "Objetos",
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
  test("every ribbon button keeps a name and an icon", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    const ribbon = page.getByRole("toolbar", { name: "Acciones" });
    await expect(ribbon).toBeVisible();

    for (const name of RIBBON) {
      const button = ribbon.getByRole("button", { name, exact: true });
      await expect(button, `${name} is reachable by name`).toBeVisible();
      await expect(button).toBeEnabled();
      // Vector art, not a character: an emoji could not take the ribbon's colour.
      await expect(button.locator("svg")).toHaveCount(1);
    }

    // No stragglers: if a button is added, this test should have to say so.
    await expect(ribbon.getByRole("button")).toHaveCount(RIBBON.length);
  });

  test("the icons are hidden from assistive tech, the labels are not", async ({
    app,
  }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    const snippets = page
      .getByRole("toolbar", { name: "Acciones" })
      .getByRole("button", { name: "Snippets", exact: true });

    // The name has to come from the label alone. If the icon were exposed, the
    // accessible name would carry it too and this exact match would fail.
    await expect(snippets).toBeVisible();
    await expect(snippets.locator("svg[aria-hidden='true']")).toHaveCount(1);
  });

  test("Snippets opens its panel from the ribbon", async ({ app }) => {
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

  test("the tree's tools menu shows the same icons, not emoji", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    await page.getByRole("button", { name: "Herramientas" }).click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    // The same nine tools as the ribbon's second group, each with its own icon. The
    // exact-name match is what proves the emoji is gone: the label used to have one
    // glued in front of it, so the accessible name was "🖥️  Monitor de servidor" —
    // a screen reader read the decoration aloud and this match would fail.
    for (const name of RIBBON.slice(3)) {
      const item = menu.getByRole("menuitem", { name, exact: true });
      await expect(item, `${name} is in the tools menu`).toBeVisible();
      await expect(item.locator("svg")).toHaveCount(1);
    }
  });

  test("object actions stay disabled until a connection is open", async ({ app }) => {
    const { page } = app;
    await app.open();

    // Before connecting: the ribbon is there but nothing in it can be used, which
    // is the honest state — every one of these needs a database.
    const ribbon = page.getByRole("toolbar", { name: "Acciones" });
    for (const name of RIBBON) {
      await expect(
        ribbon.getByRole("button", { name, exact: true }),
        `${name} is disabled with no connection`,
      ).toBeDisabled();
    }
  });
});
