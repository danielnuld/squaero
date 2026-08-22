// Pasting rows from a spreadsheet into an open table (issue #383).
//
// Through the real interface and the real core: what is being defended is that a
// paste goes down the SAME road a file does — parsed, previewed, mapped, and
// applied in one transaction — rather than writing to somebody's database
// because a key combination happened.

import { connect, openFixtureTable, readNombre } from "./support/app-actions";
import { describeEngine, expect, test } from "./support/fixtures";

describeEngine("sqlite", () => {
  /** Fire a real paste at the document, carrying `text` as text/plain. */
  const paste = (page: import("@playwright/test").Page, text: string) =>
    page.evaluate((payload) => {
      const data = new DataTransfer();
      data.setData("text/plain", payload);
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);

  test("pasting TSV over a table opens the wizard, and importing writes the rows", async ({
    app,
  }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await paste(page, "id\tnombre\n901\tEmpalme\n902\tMagdalena");

    // It opened the wizard, not the database: nothing is written yet.
    await expect(page.getByText("Vista previa de lo pegado")).toBeVisible();
    await expect(page.getByText("2 fila(s)")).toBeVisible();

    await page.getByRole("button", { name: "Importar", exact: true }).click();
    await expect(page.getByText("fila(s) insertada(s)")).toBeVisible();

    // Read straight from the database: the summary is the app's own account of
    // what it did, and that is exactly what is under test here. (The grid shows
    // the first page, and 901/902 sort past its end.)
    expect(await readNombre(app, 901)).toBe("Empalme");
    expect(await readNombre(app, 902)).toBe("Magdalena");
  });

  test("a paste that is not a table is left alone", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await paste(page, "Hermosillo");
    await expect(page.getByText("Vista previa de lo pegado")).toHaveCount(0);
  });
});
