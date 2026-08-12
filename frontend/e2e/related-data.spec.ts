// "Datos relacionados" and why it is or is not offered (issue #344).
//
// The report that started this was "I don't know in what situations it activates
// — they stopped appearing": four separate conditions gate the action and the
// menu entry used to be omitted when any of them failed, which is
// indistinguishable from the feature being broken. These cases hold the menu to
// saying which condition it is.
//
// The fixture has a single table and no foreign keys, which is exactly the
// schema the report came from — most of what a user meets is the unavailable
// path, so that is the path worth pinning.

import { connect, openFixtureTable, runSql } from "./support/app-actions";
import { describeEngine, test, expect } from "./support/fixtures";

describeEngine("sqlite", () => {
  /** Right-clicks the fixture cell and returns the menu. */
  async function cellMenu(page: import("@playwright/test").Page) {
    await page.getByText("Nogales", { exact: true }).click({ button: "right" });
    const menu = page.getByRole("menu");
    await menu.waitFor();
    return menu;
  }

  const relatedItem = (menu: ReturnType<typeof cellMenu> extends Promise<infer M> ? M : never) =>
    menu.getByRole("menuitem", { name: /Datos relacionados/ });

  test("says nothing references this table, instead of hiding the action", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    const item = relatedItem(await cellMenu(page));
    await expect(item).toBeVisible();
    await expect(item).toBeDisabled();
    await expect(item).toHaveText(/ninguna tabla referencia a esta/i);
  });

  test("says the result must be one table's rows", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    // A projection without the primary key: the tab cannot tell which table's
    // rows these are, which is the commonest reason the action goes quiet.
    await runSql(page, "SELECT nombre FROM e2e_items");
    await expect(page.getByText("Nogales", { exact: true })).toBeVisible();

    const item = relatedItem(await cellMenu(page));
    await expect(item).toBeDisabled();
    await expect(item).toHaveText(/una sola tabla/i);
  });
});
