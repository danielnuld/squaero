// The editor has to suggest the columns of the table you are writing about, even
// when you have never opened it.
//
// Table and view NAMES always came from the loaded tree, so those were instant. But
// COLUMNS were only cached when a table was opened, which meant the common case —
// type a query against a table you have not browsed — offered no column help at all.

import { connect } from "./support/app-actions";
import { describeAllEngines, expect, test } from "./support/fixtures";

describeAllEngines(["sqlite", "postgres", "mysql", "informix"], () => {
  test("suggests the columns of a table that was never opened", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    // Deliberately do NOT open e2e_items: this is the case that used to come up
    // empty. Only the object tree has been loaded, which is names but no columns.
    const editor = page.getByRole("textbox", { name: "Editor SQL", exact: true });
    await editor.click();
    // Name the table, then start a column: the columns are fetched from the table
    // the statement mentions, so they cannot exist before it is written.
    await page.keyboard.type("SELECT * FROM e2e_items WHERE ");
    await page.keyboard.type("nom");

    const completions = page.getByRole("listbox", { name: "Completions" });
    await expect(completions.getByRole("option", { name: "nombre" })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("completes a column after typing part of its name", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    const editor = page.getByRole("textbox", { name: "Editor SQL", exact: true });
    await editor.click();
    await page.keyboard.type("SELECT * FROM e2e_items WHERE nom");

    const completions = page.getByRole("listbox", { name: "Completions" });
    await expect(completions.getByRole("option", { name: "nombre" })).toBeVisible({
      timeout: 20_000,
    });

    // Accepting it writes the column, so the suggestion is usable and not decorative.
    await page.keyboard.press("Enter");
    await expect(editor).toContainText("nombre");
  });
});
