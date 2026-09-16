// Pasting rows as new, unsaved rows (#517, phase C).
//
// Through the real interface and the real core: a paste that fits the grid
// becomes pending rows of the open table, nothing is written until the SQL is
// reviewed and applied, and then the database really holds the rows.

import { connect, onCore, openFixtureTable, readNombre } from "./support/app-actions";
import { describeAllEngines, expect, test } from "./support/fixtures";

describeAllEngines(["sqlite", "postgres", "mysql", "informix"], (engineName) => {
  /** Fire a real paste at the document, carrying `text` as text/plain. */
  const paste = (page: import("@playwright/test").Page, text: string) =>
    page.evaluate((payload) => {
      const data = new DataTransfer();
      data.setData("text/plain", payload);
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);

  test("pasting rows that fit the table adds them unsaved, and saving writes them", async ({
    app,
  }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await paste(page, "id\tnombre\n911\tPegada uno\n912\tPegada dos");

    const bar = page.getByRole("toolbar", { name: "Filas nuevas sin guardar" });
    await expect(bar.getByText("2 filas nuevas sin guardar")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("textbox", { name: "nombre (fila nueva)", exact: true }).nth(1),
    ).toHaveValue("Pegada dos");
    // Nothing is written by the paste itself.
    expect(await readNombre(app, 911)).toBeNull();

    await bar.getByRole("button", { name: /Revisar y guardar/ }).click();
    await expect(page.getByText(/INSERT .*e2e_items/).first()).toBeVisible();
    await page.getByRole("button", { name: "Aplicar y confirmar" }).click();

    await expect.poll(() => readNombre(app, 911), { timeout: 15_000 }).toBe("Pegada uno");
    expect(await readNombre(app, 912)).toBe("Pegada dos");
  });

  test("a pasted key that already exists blocks saving until it is fixed", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    // Row 1 already holds id 1; a pasted text keeps its key.
    await paste(page, "1\tRepetida");
    const bar = page.getByRole("toolbar", { name: "Filas nuevas sin guardar" });
    await expect(bar.getByText("1 choca con un valor que ya existe")).toBeVisible({
      timeout: 15_000,
    });
    const save = bar.getByRole("button", { name: /Revisar y guardar/ });
    await expect(save).toBeDisabled();

    await page.getByRole("textbox", { name: "id (fila nueva)", exact: true }).fill("913");
    await expect(save).toBeEnabled();
    await save.click();
    await page.getByRole("button", { name: "Aplicar y confirmar" }).click();

    await expect.poll(() => readNombre(app, 913), { timeout: 15_000 }).toBe("Repetida");
    expect(await readNombre(app, 1)).toBe("Nogales");
  });

  // A unique index the fixture does not have (reseeding drops it with the table).
  // Where the catalog gives the index's columns — SQLite, PostgreSQL, MySQL — the
  // repeated value is caught before saving. Informix's listing has no columns, so
  // there the database is what says no, the session survives, and fixing the row
  // saves it.
  test("a pasted value a unique index already holds is caught, and saves once fixed", async ({
    app,
  }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);
    // Created after the table is on screen: MySQL pages an ORDER BY-less preview
    // through the new index, which pushes "Nogales" off the first page. The index
    // is still there to find, because the catalog is read on entering edit mode,
    // and the paste below is what enters it.
    await onCore(app, "CREATE UNIQUE INDEX e2e_items_nombre_uq ON e2e_items (nombre)");

    // Row 1 is "Nogales"; the pasted id is new, the name is not.
    await paste(page, "921\tNogales");
    const bar = page.getByRole("toolbar", { name: "Filas nuevas sin guardar" });
    await expect(bar.getByText("1 fila nueva sin guardar")).toBeVisible({ timeout: 15_000 });
    const save = bar.getByRole("button", { name: /Revisar y guardar/ });
    const nombre = page.getByRole("textbox", { name: "nombre (fila nueva)", exact: true });

    if (engineName === "informix") {
      await save.click();
      await page.getByRole("button", { name: "Aplicar y confirmar" }).click();
      await expect(page.getByText(/Error al aplicar/)).toBeVisible({ timeout: 15_000 });
      // The pending row is still there to fix.
      await expect(nombre).toHaveValue("Nogales");
    } else {
      await expect(bar.getByText("1 choca con un valor que ya existe")).toBeVisible({
        timeout: 15_000,
      });
      await expect(nombre).toHaveAttribute("aria-invalid", "true");
      await expect(save).toBeDisabled();
    }
    expect(await readNombre(app, 921)).toBeNull();

    await nombre.fill("Unica");
    await expect(save).toBeEnabled();
    await save.click();
    await page.getByRole("button", { name: "Aplicar y confirmar" }).click();

    await expect.poll(() => readNombre(app, 921), { timeout: 15_000 }).toBe("Unica");
    expect(await readNombre(app, 1)).toBe("Nogales");
  });
});
