// Editing the rows a hand-written query returned (issue #718).
//
// Opening a table from the tree was the only reliable way to get the edit
// functions; a SELECT typed in the editor came back read-only, and said nothing
// about why. A single-table SELECT with its primary key projected must be as
// editable as the table view, and one that is not must say why instead of hiding
// the button.

import { connect, readNombre, runSql } from "./support/app-actions";
import { describeAllEngines, expect, test } from "./support/fixtures";

describeAllEngines(["sqlite", "postgres", "mysql", "informix"], (name) => {
  test("a single-table query is editable: edit a cell and apply it", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    // Written the way people write: upper-case names, an alias, a WHERE, a
    // trailing `;`. PostgreSQL and Informix fold the unquoted table name to
    // lower case and the describe has to as well; MySQL keeps `ID` as the
    // result's column name while its catalog says `id`. (A MySQL table name is
    // case-sensitive on Linux, so there it is written as it was created.)
    const table = name === "mysql" ? "e2e_items" : "E2E_ITEMS";
    await runSql(page, `select ID, NOMBRE from ${table} t where t.id = 1 order by id;`);
    await expect(page.getByText("Nogales", { exact: true })).toBeVisible();

    const edit = page.getByRole("button", { name: "Editar", exact: true });
    await expect(edit).toBeEnabled();
    await edit.click();

    await page.getByRole("textbox", { name: /^nombre$/i }).fill("Nogales editado");
    const confirm = page.getByRole("button", { name: /Confirmar \(1\)/ });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByText(/UPDATE .*e2e_items/i)).toBeVisible();
    await page.getByRole("button", { name: "Aplicar y confirmar" }).click();

    // Read back from the database, not from the grid.
    await expect.poll(() => readNombre(app, 1), { timeout: 15_000 }).toBe("Nogales editado");
  });

  test("a query that cannot be edited says why", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    // The key is not in the result, so no single row can be pointed at.
    await runSql(page, "SELECT nombre FROM e2e_items WHERE id = 2");
    await expect(page.getByText(app.engine.encodingRows.discriminator, { exact: true })).toBeVisible();

    const edit = page.getByRole("button", { name: "Editar", exact: true });
    await expect(edit).toBeDisabled();
    await expect(edit).toHaveAccessibleDescription(/no incluye la clave primaria/);
  });
});
