// The journey that must work on every engine, driven through the interface.
//
// Each engine is its own describe block, so a failure names the engine it belongs
// to rather than leaving you to guess which of four broke.

import {
  cell,
  connect,
  disconnect,
  editRow,
  nombreCell,
  openFixtureTable,
  readNombre,
  runSql,
} from "./support/app-actions";
import { describeAllEngines, expect, test } from "./support/fixtures";

describeAllEngines(["sqlite", "postgres", "mysql", "informix"], (engineName) => {
  test("connects and shows the connection as open", async ({ app }) => {
    await app.open();
    // Before connecting the interface says so, and the object actions are dead.
    await expect(app.page.getByText("Sin conexión")).toBeVisible();
    await expect(app.page.getByRole("button", { name: "Objetos" })).toBeDisabled();

    await connect(app);

    await expect(app.page.getByRole("button", { name: /conectado/ })).toBeVisible();
    await expect(app.page.getByRole("button", { name: "Objetos" })).toBeEnabled();
  });

  test("browses to the fixture table and reads its rows", async ({ app }) => {
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await expect(cell(app.page, "Nogales")).toBeVisible();
  });

  test("shows each column with its type", async ({ app }) => {
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    // The grid header names the column and its type, which is the describe a user
    // actually sees when opening a table.
    await expect(app.page.getByRole("button", { name: /^id / })).toBeVisible();
    await expect(app.page.getByRole("button", { name: /^nombre / })).toBeVisible();
  });

  test("shows the whole table as one page and says how many rows", async ({ app }) => {
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    // The page size is 1000 rows, so this fixture is a single page. Both pager
    // buttons must therefore be dead, and the count must be the truth.
    //
    // This is NOT the paging test it looks like: exercising a second page needs a
    // fixture of more than a thousand rows, which is recorded as work to do rather
    // than asserted here. A test that passes because the branch never runs is worse
    // than no test, because it reads as coverage.
    await expect(app.page.getByRole("button", { name: /Anterior/ })).toBeDisabled();
    await expect(app.page.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
    await expect(app.page.getByText(/Filas 1–28/)).toBeVisible();
    await expect(cell(app.page, "Nogales")).toBeVisible();
  });

  test("reports a statement the engine rejects, and stays usable", async ({ app }) => {
    await app.open();
    await connect(app);

    await runSql(app.page, "SELECT * FROM tabla_que_no_existe_e2e");
    // The engine's own words reach the user; the interface does not hang waiting.
    await expect(app.page.getByRole("alert").first()).toBeVisible({ timeout: 20_000 });

    // Still usable: a good query afterwards works.
    await runSql(app.page, "SELECT nombre FROM e2e_items WHERE id = 1");
    await expect(cell(app.page, "Nogales")).toBeVisible({ timeout: 20_000 });
  });

  test("shows accented values exactly as the database means them", async ({ app }) => {
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    const { accented, discriminator } = app.engine.encodingRows;

    // A plain accent, and then the row that separates a real fix from the look of
    // one: its bytes are valid UTF-8 for "ñ" but mean "Ã±" in a single-byte code
    // set, so a driver passing bytes through unchanged shows the wrong character.
    await expect(cell(app.page, accented)).toBeVisible();
    await expect(cell(app.page, discriminator)).toBeVisible();
    if (discriminator !== "ñ") {
      await expect(cell(app.page, "ñ")).toBeHidden();
    }
  });

  test("filters by an accented value and finds its rows", async ({ app }) => {
    await app.open();
    await connect(app);

    // Sending an accented literal is its own hazard: on Informix an unconverted
    // statement matched nothing at all, silently (#324).
    await runSql(
      app.page,
      `SELECT id, nombre FROM e2e_items WHERE nombre = '${app.engine.encodingRows.accented}'`,
    );
    await expect(cell(app.page, app.engine.encodingRows.accented)).toBeVisible({
      timeout: 20_000,
    });
  });

  test("saves an edit and the database really changed", async ({ app }) => {
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await editRow(app.page, "Nogal");
    await nombreCell(app.page).fill("Nogal editado");
    // The pending-change counter is the interface's own account of what it will do.
    await expect(app.page.getByRole("button", { name: /Confirmar \(1\)/ })).toBeEnabled();
    await app.page.getByRole("button", { name: /Confirmar \(1\)/ }).click();

    // It shows the exact statement before running it, which is the whole point of
    // a confirmation step: the user gets to see the UPDATE, not just trust it.
    await expect(app.page.getByText(/UPDATE .*e2e_items/)).toBeVisible();
    await app.page.getByRole("button", { name: "Aplicar y confirmar" }).click();

    // Read it back from the database, not from the grid: the grid showing a value
    // proves nothing about what was committed.
    await expect
      .poll(() => readNombre(app, 1), { timeout: 15_000 })
      .toBe("Nogal editado");
  });

  test("discards an edit and the database is untouched", async ({ app }) => {
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await editRow(app.page, "Nogal");
    await nombreCell(app.page).fill("No debe guardarse");
    await expect(app.page.getByRole("button", { name: /Confirmar \(1\)/ })).toBeEnabled();
    await app.page.getByRole("button", { name: "Descartar" }).click();

    expect(await readNombre(app, 1)).toBe("Nogales");
  });

  test("exports the result with its accented values intact", async ({ app }) => {
    // Chromium offers the File System Access API, and the app prefers it — which
    // opens a native save dialog no browser automation can drive. Removing it makes
    // the app take its documented anchor-download fallback, the same path a browser
    // without the API uses. The picker path itself belongs to the shell surface this
    // suite does not cover.
    await app.page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    });

    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await app.page.getByRole("button", { name: "Exportar" }).click();
    const download = app.page.waitForEvent("download");
    await app.page.getByRole("menuitem", { name: "CSV" }).click();

    const file = await download;
    const stream = await file.createReadStream();
    const csv = await new Promise<string>((resolve, reject) => {
      let text = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => (text += String(chunk)));
      stream.on("end", () => resolve(text));
      stream.on("error", reject);
    });

    // The same rows, and the same characters: an export that mangles the accent is
    // the same class of bug as a grid that does.
    expect(csv).toContain("Nogales");
    expect(csv).toContain(app.engine.encodingRows.accented);
    expect(csv).toContain(app.engine.encodingRows.discriminator);
  });

  test("disconnects", async ({ app }) => {
    await app.open();
    await connect(app);
    await disconnect(app.page);

    await expect(app.page.getByText("Sin conexión")).toBeVisible();
    await expect(app.page.getByRole("button", { name: "Objetos" })).toBeDisabled();
    expect(engineName).toBe(app.engine.name); // the block really is this engine
  });
});
