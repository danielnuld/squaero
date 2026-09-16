// The paste-as-new-rows flow with the interface in English (#517, task 4.2).
//
// The catalogs are checked key by key in a unit test; what this covers is the
// part that cannot: that the strings the flow actually shows are the English
// ones, in the places the flow puts them.

import { readNombre } from "./support/app-actions";
import { describeEngine, expect, test, type App } from "./support/fixtures";

describeEngine("sqlite", () => {
  test.use({ uiLocale: "en" });

  // The shared helpers address the interface in Spanish, down to the "Tablas"
  // node spelled out in the engine fixture, so the same steps are done here in
  // English. That the labels differ is the point of this file.
  async function connectAndOpenTable(app: App) {
    const { page, engine } = app;
    await page.getByRole("button", { name: "Connect to a database…" }).click();
    // The + opens a search over the saved connections (#525). Scoped to the
    // dialog, so the engine name cannot match a row of the bar behind it.
    const search = page.getByRole("dialog", { name: "Search for a connection" });
    await search.waitFor();
    await search.getByRole("button", { name: new RegExp(engine.label) }).click();
    // There is no bare "Disconnect" left to wait for: every disconnect is named
    // after its connection, so the signal is the connection's row in the bar.
    await page.getByRole("button", { name: new RegExp(`^${engine.label}`) }).first().waitFor();

    const row = (name: string) => page.getByRole("treeitem", { name, exact: true }).first();
    await row("main").click();
    await row("Tables").click();
    await row("e2e_items").click();
    await expect(page.getByText("Nogales").first()).toBeVisible();
  }

  const paste = (page: import("@playwright/test").Page, text: string) =>
    page.evaluate((payload) => {
      const data = new DataTransfer();
      data.setData("text/plain", payload);
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);

  test("marks, pastes and saves rows with every label in English", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connectAndOpenTable(app);

    // Marking: the row checkbox and the bar that appears with it.
    await page.getByRole("checkbox", { name: "Mark row 1", exact: true }).click();
    const rowBar = page.getByRole("toolbar", { name: "Actions on the marked rows" });
    await expect(rowBar.getByText("1 row marked")).toBeVisible();
    // "Copy" and "Copy as INSERT" both start with Copy; the first carries its key.
    await expect(rowBar.getByRole("button", { name: /^Copy Ctrl\+C/ })).toBeVisible();
    await expect(rowBar.getByRole("button", { name: "Copy as INSERT" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Mark every visible row" }).click();
    await expect(rowBar.getByText("28 rows marked")).toBeVisible();

    // Pasting: the pending-rows bar, its key choice and the empty-cell choice.
    await paste(page, "931\tPasted in English");
    const bar = page.getByRole("toolbar", { name: "New unsaved rows" });
    await expect(bar.getByText("1 new unsaved row")).toBeVisible({ timeout: 15_000 });
    await expect(bar.getByRole("button", { name: "Key: keep the copied one" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Empty as NULL" })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "nombre (new row)", exact: true }),
    ).toHaveValue("Pasted in English");

    await bar.getByRole("button", { name: /Review and save/ }).click();
    await page.getByRole("button", { name: "Apply and confirm" }).click();

    await expect.poll(() => readNombre(app, 931), { timeout: 15_000 }).toBe("Pasted in English");
  });

  test("says in English why a repeated key cannot be saved", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connectAndOpenTable(app);

    await paste(page, "1\tRepeated");
    const bar = page.getByRole("toolbar", { name: "New unsaved rows" });
    await expect(bar.getByText("1 collides with an existing value")).toBeVisible({
      timeout: 15_000,
    });
    await expect(bar.getByRole("button", { name: /Review and save/ })).toBeDisabled();
  });
});
