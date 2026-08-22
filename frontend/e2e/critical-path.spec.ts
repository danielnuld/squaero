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
import { bulkFill } from "./support/seed";

describeAllEngines(["sqlite", "postgres", "mysql", "informix"], (engineName) => {
  test("connects and shows the connection as open", async ({ app }) => {
    await app.open();
    // Before connecting the interface says so, and the tools are dead. They live
    // in the ⋯ strip now (#386), which is folded until asked.
    await expect(app.page.getByText("Sin conexión")).toBeVisible();
    const monitor = app.page
      .getByRole("toolbar", { name: "Acciones" })
      .getByRole("button", { name: "Monitor de servidor", exact: true });
    await expect(monitor).toBeDisabled();

    await connect(app);

    await expect(app.page.getByRole("button", { name: /conectado/ })).toBeVisible();
    await expect(monitor).toBeEnabled();
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
    // actually sees when opening a table. They are column headers, not buttons, so
    // assistive tech can report which column it is reading and how it is sorted.
    const id = app.page.getByRole("columnheader", { name: /^id / });
    const nombre = app.page.getByRole("columnheader", { name: /^nombre / });
    await expect(id).toBeVisible();
    await expect(nombre).toBeVisible();

    // Unsorted to begin with, and the header says so once it is sorted.
    await expect(id).toHaveAttribute("aria-sort", "none");
    await id.click();
    await expect(id).toHaveAttribute("aria-sort", "ascending");
  });

  test("pages through a table larger than one page", async ({ app }) => {
    // The grid pages at 1000 rows, so the base fixture of 28 would never reach a
    // second page: the case has to grow the table itself. Only this test pays that
    // cost, and the per-test reseed takes the rows away again afterwards.
    await bulkFill(app.rpc, app.engine.name);

    await app.open();
    await connect(app);
    await openFixtureTable(app);

    const previous = app.page.getByRole("button", { name: /Anterior/ });
    const next = app.page.getByRole("button", { name: /Siguiente/ });

    // First page: nothing before it, something after it, and the first row present.
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    await expect(app.page.getByText(/Filas 1–1000/)).toBeVisible();
    await expect(cell(app.page, "Nogales")).toBeVisible();

    await next.click();

    // Second page: different rows, and the pager reflects where we are. Asserting
    // the row window moved is what proves the offset was really applied — a page
    // that silently re-ran the same query would still look busy and full.
    await expect(app.page.getByText(/Filas 1001–/)).toBeVisible();
    await expect(cell(app.page, "Nogales")).toBeHidden();
    await expect(previous).toBeEnabled();

    // And back, so the pager is not one-way.
    await previous.click();
    await expect(app.page.getByText(/Filas 1–1000/)).toBeVisible();
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
    await expect(
      app.page
        .getByRole("toolbar", { name: "Acciones" })
        .getByRole("button", { name: "Monitor de servidor", exact: true }),
    ).toBeDisabled();
    expect(engineName).toBe(app.engine.name); // the block really is this engine
  });
});
