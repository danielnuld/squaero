// Retrying a save that failed halfway (openspec: paste-rows-as-inserts, fase A).
//
// Three new rows, the second one reusing a key that already exists. Before the
// fix the failed apply left the transaction open with the first insert already
// run, so the retry ran it again and collided with itself (and PostgreSQL
// refused everything in the aborted transaction). Now a failure rolls back and
// opens a fresh transaction: fixing the one bad row and saving again must leave
// exactly the three rows in the database.

import { connect, openFixtureTable, readNombre } from "./support/app-actions";
import { describeAllEngines, expect, test } from "./support/fixtures";

describeAllEngines(["sqlite", "postgres", "mysql", "informix"], () => {
  test("a save that failed halfway can be fixed and retried without duplicating rows", async ({
    app,
  }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await page.getByRole("button", { name: "Editar", exact: true }).click();
    const addRow = page.getByRole("button", { name: "Fila", exact: true });
    await addRow.click();
    await addRow.click();
    await addRow.click();

    const ids = page.getByRole("textbox", { name: "id (fila nueva)", exact: true });
    const nombres = page.getByRole("textbox", { name: "nombre (fila nueva)", exact: true });
    await expect(ids).toHaveCount(3);
    // Row 1 already holds id 1 ("Nogales"): the second insert must fail.
    const rows: [string, string][] = [
      ["901", "Primera"],
      ["1", "Choca"],
      ["902", "Tercera"],
    ];
    for (const [i, [id, nombre]] of rows.entries()) {
      await ids.nth(i).fill(id);
      await nombres.nth(i).fill(nombre);
    }

    const confirm = page.getByRole("button", { name: /Confirmar \(3\)/ });
    await confirm.click();
    await page.getByRole("button", { name: "Aplicar y confirmar" }).click();
    await expect(page.getByText(/Error al aplicar/)).toBeVisible({ timeout: 15_000 });

    // Nothing was committed: the first row is not in the database.
    expect(await readNombre(app, 901)).toBeNull();

    await ids.nth(1).fill("903");
    await confirm.click();
    await page.getByRole("button", { name: "Aplicar y confirmar" }).click();

    await expect.poll(() => readNombre(app, 903), { timeout: 15_000 }).toBe("Choca");
    expect(await readNombre(app, 901)).toBe("Primera");
    expect(await readNombre(app, 902)).toBe("Tercera");
    expect(await readNombre(app, 1)).toBe("Nogales");
  });
});
