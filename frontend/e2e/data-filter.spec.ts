// The filter panel of a table tab (issue #347), through the real interface.
//
// The claim being tested is the one that justifies the feature: the condition
// runs at the SERVER, over the whole table, not over the page already on screen.
// The grid's own header sort and column filters never left the browser, which is
// what it has been warning about under every truncated result.

import { connect, openFixtureTable } from "./support/app-actions";
import { describeEngine, test, expect } from "./support/fixtures";

describeEngine("sqlite", () => {
  const panel = (page: import("@playwright/test").Page) =>
    page.getByRole("region", { name: "Filtro y orden de la tabla" });

  test("opens a table with the panel and no editor", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await expect(panel(page)).toBeVisible();
    // Unfolded on arrival: a filter nobody can see is a filter nobody uses.
    await expect(page.getByRole("button", { name: "+ condición" })).toBeVisible();
    // The editor is gone, and with it the buttons that acted on it.
    await expect(page.getByRole("textbox", { name: "Editor SQL", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Formatear" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ejecutar", exact: true })).toHaveCount(0);
    // What still has an object stays.
    await expect(page.getByRole("button", { name: "Plan" })).toBeVisible();
  });

  test("a condition filters at the server, not the loaded page", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);
    await expect(page.getByText("Nogales", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "+ condición" }).click();
    await panel(page).getByRole("combobox", { name: "Columna" }).selectOption("nombre");
    await panel(page).getByRole("combobox", { name: "Operador" }).selectOption("CONTAINS");
    await panel(page).getByRole("textbox", { name: "Valor" }).fill("Obreg");

    // Written but not applied: the grid still shows what it fetched, and says so.
    await expect(page.getByText("Criterios sin aplicar")).toBeVisible();
    await expect(page.getByText("Nogales", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Aplicar", exact: true }).click();

    await expect(page.getByText("Cd. Obregón", { exact: true })).toBeVisible();
    await expect(page.getByText("Nogales", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Criterios sin aplicar")).toHaveCount(0);

    // And the narrowing really happened in the query: SQL ↗ opens what ran.
    await page.getByRole("button", { name: "SQL", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Editor SQL", exact: true })).toContainText(
      "WHERE",
    );
    await expect(page.getByRole("textbox", { name: "Editor SQL", exact: true })).toContainText(
      "LIKE '%Obreg%'",
    );
  });

  test("an unchecked condition is kept but not applied", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await page.getByRole("button", { name: "+ condición" }).click();
    await panel(page).getByRole("combobox", { name: "Columna" }).selectOption("nombre");
    await panel(page).getByRole("combobox", { name: "Operador" }).selectOption("CONTAINS");
    await panel(page).getByRole("textbox", { name: "Valor" }).fill("Obreg");
    await page.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(page.getByText("Nogales", { exact: true })).toHaveCount(0);

    // Off: every row comes back, and the criterion is still written down.
    await panel(page).getByRole("checkbox", { name: /Usar la condición/ }).uncheck();
    await page.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(page.getByText("Nogales", { exact: true })).toBeVisible();
    await expect(panel(page).getByRole("textbox", { name: "Valor" })).toHaveValue("Obreg");
  });

  test("clearing brings every row back", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await page.getByRole("button", { name: "+ condición" }).click();
    await panel(page).getByRole("combobox", { name: "Columna" }).selectOption("nombre");
    await panel(page).getByRole("combobox", { name: "Operador" }).selectOption("CONTAINS");
    await panel(page).getByRole("textbox", { name: "Valor" }).fill("Obreg");
    await page.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(page.getByText("Nogales", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Limpiar" }).click();
    await expect(page.getByText("Nogales", { exact: true })).toBeVisible();
    await expect(panel(page).getByRole("textbox", { name: "Valor" })).toHaveCount(0);
  });

  test("sorting from the panel orders in the query", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await page.getByRole("button", { name: "+ orden" }).click();
    await panel(page).getByRole("combobox", { name: "Columna de ordenación" }).selectOption("nombre");
    await page.getByRole("button", { name: "Aplicar", exact: true }).click();

    await page.getByRole("button", { name: "SQL", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Editor SQL", exact: true })).toContainText(
      "ORDER BY",
    );
  });
});

// Issue #347, the sort half: a header click used to reorder the rows already
// fetched. Over a truncated result that is a different answer than the one it
// looks like, and the grid said so in small print under every page.
describeEngine("sqlite", () => {
  test("a header click sorts in the query, and the panel says so", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    const header = page.getByRole("columnheader", { name: /^nombre/ });
    await expect(header).toHaveAttribute("aria-sort", "none");

    await header.click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    // The click wrote the sort into the panel, which is where it now lives. The
    // panel rests folded (#386), so its bar is what has to say so; unfolding it
    // then shows the row itself.
    const panel = page.getByRole("region", { name: "Filtro y orden de la tabla" });
    await expect(panel.getByText("1 orden(es)")).toBeVisible();
    await panel.getByRole("button", { name: /Filtro/ }).click();
    await expect(panel.getByRole("combobox", { name: "Columna de ordenación" })).toHaveValue(
      "nombre",
    );
    // And it went into the query, not into the loaded page.
    await page.getByRole("button", { name: "SQL", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Editor SQL", exact: true })).toContainText(
      "ORDER BY",
    );
  });

  test("a header click cycles ascending, descending, off", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    const header = page.getByRole("columnheader", { name: /^nombre/ });
    await header.click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await header.click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await header.click();
    await expect(header).toHaveAttribute("aria-sort", "none");
  });
});
