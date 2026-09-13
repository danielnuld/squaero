// SQL Server through the interface (issue #49), phase 1: what the driver offers
// today — connecting, the object tree, reading and paging a table, running SQL.
//
// Its own file rather than a fifth engine in critical-path: that journey edits
// rows, and this driver does not build DML yet, so those cases would fail for a
// reason that is a missing feature, not a regression.

import { cell, connect, openFixtureTable, runSql } from "./support/app-actions";
import { describeEngine, expect, test } from "./support/fixtures";
import { bulkFill } from "./support/seed";

describeEngine("mssql", () => {
  test("browses to the fixture table and reads its Unicode rows", async ({ app }) => {
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await expect(cell(app.page, "Nogales")).toBeVisible();
    // nvarchar through FreeTDS's UTF-8 conversion: exact strings, not look-alikes.
    await expect(cell(app.page, app.engine.encodingRows.accented)).toBeVisible();
    await expect(cell(app.page, app.engine.encodingRows.discriminator)).toBeVisible();
  });

  test("shows each column with its type", async ({ app }) => {
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await expect(app.page.getByRole("columnheader", { name: /^id / })).toBeVisible();
    await expect(app.page.getByRole("columnheader", { name: /^nombre / })).toBeVisible();
  });

  test("pages past the first 1000 rows with OFFSET … FETCH", async ({ app }) => {
    await bulkFill(app.rpc, app.engine.name);
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await expect(app.page.getByText(/Filas 1–1000/)).toBeVisible();
    await expect(cell(app.page, "Nogales")).toBeVisible();

    await app.page.getByRole("button", { name: /Siguiente/ }).click();

    // The window moved: a preview that re-ran the first page would still show row 1.
    await expect(app.page.getByText(/Filas 1001–/)).toBeVisible();
    await expect(cell(app.page, "Nogales")).toBeHidden();
  });

  test("runs SQL typed in the editor", async ({ app }) => {
    await app.open();
    await connect(app);

    await runSql(app.page, "SELECT N'ñandú' AS saludo, 6 * 7 AS respuesta");

    await expect(cell(app.page, "ñandú")).toBeVisible();
    await expect(cell(app.page, "42")).toBeVisible();
  });
});
