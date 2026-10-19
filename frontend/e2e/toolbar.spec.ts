// The tools, and the names they keep.
//
// The ribbon of twelve buttons (#386) and then the strip of tool icons under
// the tabs are gone (#688): tools live in the explorer's Herramientas menu, the
// native menu bar and the Ctrl+K palette. What must not be lost is that every
// destination is reachable by an accessible name, with decorative SVG icons
// rather than emoji that announce themselves.

import { connect, openFixtureTable, openTool } from "./support/app-actions";
import { describeEngine, expect, test } from "./support/fixtures";

/** The tools, by the accessible name a user hears. */
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
  "Respaldo y restauración",
  "Conexiones",
];

describeEngine("sqlite", () => {
  test("Snippets opens its panel from the tools menu", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    await openTool(page, "Snippets");

    // It opens as a tab, the same one the editor's own button and Ctrl+J reach,
    // so they focus a single panel rather than piling up duplicates.
    await expect(page.getByRole("button", { name: /Cerrar pestaña/ }).nth(1)).toBeVisible();
    await expect(page.getByText("Snippets").first()).toBeVisible();
  });

  test("a data tab's Más menu opens the tool it names", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    // It did nothing once: switching to the tool's tab re-ran a memo the data
    // tab owned and Solid threw "Stale read from <Show>".
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("toolbar", { name: "Acciones del objeto" }).getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Sincronizar estructura…" }).click();

    await expect(page.getByRole("tab", { name: "Sincronizar estructura" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the search button opens the palette the tools also live in", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    await page.getByRole("button", { name: "Buscar objetos, herramientas y acciones" }).click();

    const palette = page.getByRole("dialog", { name: "Paleta de comandos" });
    await expect(palette).toBeVisible();
    for (const name of TOOLS) {
      await expect(palette.getByText(name, { exact: true }).first()).toBeVisible();
    }
  });

  test("the tools menu shows every tool with an icon, not emoji", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    await page.getByRole("button", { name: "Herramientas", exact: true }).first().click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    // The exact-name match is what proves no emoji is glued to the label: it
    // would land in the accessible name and the match would fail.
    for (const name of TOOLS) {
      const item = menu.getByRole("menuitem", { name, exact: true });
      await expect(item, `${name} is in the tools menu`).toBeVisible();
      await expect(item.locator("svg")).toHaveCount(1);
    }
  });
});
