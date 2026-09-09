// Variables in the editor's SQL (issue #481), through the real interface.
//
// Two claims, and the second is the one that is easy to get wrong: the statement
// that reaches the engine carries the VALUES (a `:nombre` written as a literal,
// a `${nombre}` written as typed), and the editor still shows the query the user
// wrote. A tab that quietly rewrote its own SQL would look identical on the first
// run and be unusable on the second.

import { connect, runSql, cell } from "./support/app-actions";
import { describeAllEngines, test, expect } from "./support/fixtures";

type Page = import("@playwright/test").Page;

const dialog = (page: Page) => page.getByRole("dialog", { name: "Valores de la consulta" });
const editor = (page: Page) => page.getByRole("textbox", { name: "Editor SQL", exact: true });

describeAllEngines(["sqlite", "mysql", "postgres", "informix"], () => {
  test("asks for the values, then runs the statement with them", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    await runSql(page, "SELECT * FROM ${tabla} WHERE nombre = :nombre");

    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByLabel("${tabla}").fill("e2e_items");
    await dialog(page).getByLabel(":nombre").fill("Nogales");
    await dialog(page).getByRole("button", { name: "Ejecutar" }).click();

    // The value was written as a literal and the table name as typed: one row.
    await expect(cell(page, "Nogales")).toBeVisible({ timeout: 20_000 });
    await expect(cell(page, "Cd. Obregón")).toHaveCount(0);

    // And the editor still holds the query, not what was sent.
    await expect(editor(page)).toContainText("${tabla}");
    await expect(editor(page)).toContainText(":nombre");
  });

  test("remembers the values, and the toolbar reopens them", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    await runSql(page, "SELECT * FROM ${tabla} WHERE nombre = :nombre");
    await dialog(page).getByLabel("${tabla}").fill("e2e_items");
    await dialog(page).getByLabel(":nombre").fill("Nogales");
    await dialog(page).getByRole("button", { name: "Ejecutar" }).click();
    await expect(cell(page, "Nogales")).toBeVisible({ timeout: 20_000 });

    // Running again asks nothing: the tab kept what it was run with.
    await page.getByRole("button", { name: "Ejecutar", exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(cell(page, "Nogales")).toBeVisible({ timeout: 20_000 });

    // Changing them is the button's job, since nothing else asks any more.
    await page.getByRole("button", { name: "Variables", exact: true }).click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByLabel(":nombre").fill("Cd. Obregón");
    await dialog(page).getByRole("button", { name: "Ejecutar" }).click();

    await expect(cell(page, "Cd. Obregón")).toBeVisible({ timeout: 20_000 });
    await expect(cell(page, "Nogales")).toHaveCount(0);
  });

  test("a query with no variables runs without a dialog", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    // A cast and a time in a string: punctuation, not variables.
    await runSql(page, "SELECT nombre FROM e2e_items WHERE nombre = 'Nogales' -- :nada");

    await expect(cell(page, "Nogales")).toBeVisible({ timeout: 20_000 });
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Variables", exact: true })).toHaveCount(0);
  });
});
