// Several connections open at once, and finding the next one (issue #525).
//
// The rest of the suite opens ONE connection and works in it, so what the bar
// exists for is exactly what nothing covered: two connections up at the same
// time, each with its own section in the explorer, and switching between them
// without closing either. The search is the other half — with thirty saved
// connections, being able to type three letters is the whole feature.
//
// Two connections to the same SQLite file, told apart by name. That is a real
// thing to do (the same database through two saved entries) and it keeps the
// case about the interface rather than about having four engines up.
//
// NAMING NOTE. A bar row is addressed by what it SAYS, not by its tooltip: a
// button that has text inside takes its accessible name from that text, so the
// row is named "Ventas SQLite · /path/to.db" and its `title` ("Trabajar en
// Ventas") never reaches the accessible name at all. Asking for the title is
// how this file failed first. The rows are scoped to the bar's list because the
// explorer section for the same connection is a button called just "Ventas".

import type { Locator } from "@playwright/test";

import { describeEngine, expect, test, type App } from "./support/fixtures";
import { seedConnections } from "./support/state";

/** The two saved connections every case here starts from. */
const twoConnections = (app: App) => [
  {
    id: "e2e-ventas",
    name: "Ventas",
    driver: app.engine.driver,
    params: app.engine.dsn,
    group: "Producción",
  },
  {
    id: "e2e-nomina",
    // Accented on purpose: typing "nomina" has to find it (issue #525).
    name: "Nómina",
    driver: app.engine.driver,
    params: app.engine.dsn,
    group: "Producción",
  },
];

/** A row of the bar, by the connection it carries. */
const rowIn = (bar: Locator, name: string) =>
  bar.getByRole("button", { name: new RegExp(`^${name}`) });

describeEngine("sqlite", () => {
  test.use({ seedConnection: false });

  test("opens two connections from the search and switches between them", async ({
    app,
  }) => {
    const { page } = app;
    await seedConnections(page, twoConnections(app));
    await app.open();

    const bar = page.getByRole("list", { name: "Conexiones abiertas" });
    const search = page.getByRole("dialog", { name: "Buscar una conexión" });
    const openOne = async (name: string) => {
      await page.getByRole("button", { name: "Conectar a una base…" }).click();
      await search.getByRole("button", { name: new RegExp(name) }).click();
      await rowIn(bar, name).waitFor();
    };

    // Nothing is open yet, and the bar says so rather than showing an empty list.
    await expect(page.getByText("No hay ninguna conexión abierta")).toBeVisible();

    await openOne("Ventas");
    await openOne("Nómina");

    // Both are up: two rows, and the count agrees with them.
    await expect(bar.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("2 abiertas")).toBeVisible();

    // Each one brought its own section to the explorer (issue #444), named after
    // the connection — which is what makes two of them worth having.
    for (const name of ["Ventas", "Nómina"]) {
      await expect(
        page.getByRole("button", { name, exact: true }),
        `${name} has its own explorer section`,
      ).toBeVisible();
    }

    // The one just opened has the focus.
    await expect(rowIn(bar, "Nómina")).toHaveAttribute("aria-current", "true");
    await expect(rowIn(bar, "Ventas")).not.toHaveAttribute("aria-current", "true");

    // A click focuses the other one — and closes nothing, which is the whole
    // difference between this bar and the single-row one it replaced.
    await rowIn(bar, "Ventas").click();
    await expect(rowIn(bar, "Ventas")).toHaveAttribute("aria-current", "true");
    await expect(rowIn(bar, "Nómina")).not.toHaveAttribute("aria-current", "true");
    await expect(bar.getByRole("listitem")).toHaveCount(2);
  });

  test("searches by engine and by name, and says which one is already open", async ({
    app,
  }) => {
    const { page } = app;
    await seedConnections(page, twoConnections(app));
    await app.open();

    const bar = page.getByRole("list", { name: "Conexiones abiertas" });
    const search = page.getByRole("dialog", { name: "Buscar una conexión" });
    const field = search.getByRole("searchbox", {
      name: "Buscar por nombre, motor o servidor",
    });

    await page.getByRole("button", { name: "Conectar a una base…" }).click();
    await search.getByRole("button", { name: /Ventas/ }).click();
    await rowIn(bar, "Ventas").waitFor();

    await page.getByRole("button", { name: "Conectar a una base…" }).click();
    // Both saved connections, under the group they share.
    await expect(search.getByRole("listitem")).toHaveCount(2);
    await expect(search.getByText("Producción")).toBeVisible();

    // By engine: neither name contains "sqlite", so this can only match through
    // the driver's label.
    await field.fill("sqlite");
    await expect(search.getByRole("listitem")).toHaveCount(2);

    // By name, without the accent anyone would skip while typing fast.
    await field.fill("nomina");
    await expect(search.getByRole("listitem")).toHaveCount(1);
    await expect(search.getByRole("button", { name: /Nómina/ })).toBeVisible();

    // Nothing matches: it says so instead of showing an empty box.
    await field.fill("zzz");
    await expect(search.getByText("Ninguna conexión coincide.")).toBeVisible();

    // The one already open is marked, and picking it only focuses it: still one.
    await field.fill("ventas");
    await expect(search.getByText("Abierta")).toBeVisible();
    await search.getByRole("button", { name: /Ventas/ }).click();
    await expect(page.getByText("1 abierta")).toBeVisible();
  });

  // Issue #525, task 4.4: the flow walked with the interface in English. The
  // catalogs are checked key by key in a unit test; what this covers is that the
  // strings the bar, the search and the tab actually show are the English ones.
  test.describe("in English", () => {
    test.use({ uiLocale: "en" });

    test("opens a connection and manages the saved ones, all in English", async ({
      app,
    }) => {
      const { page } = app;
      await seedConnections(page, twoConnections(app));
      await app.open();

      await expect(page.getByText("No connection is open.")).toBeVisible();

      const bar = page.getByRole("list", { name: "Open connections" });
      const search = page.getByRole("dialog", { name: "Search for a connection" });
      await page.getByRole("button", { name: "Connect to a database…" }).click();
      await search
        .getByRole("searchbox", { name: "Search by name, engine or server" })
        .fill("ventas");
      await search.getByRole("button", { name: /Ventas/ }).click();

      await expect(rowIn(bar, "Ventas")).toBeVisible();
      await expect(page.getByText("1 open")).toBeVisible();

      // The search's footer is the way to the tab that owns everything which
      // outlives a session.
      await page.getByRole("button", { name: "Connect to a database…" }).click();
      await expect(search.getByText("Open")).toBeVisible();
      await search.getByRole("button", { name: "Manage", exact: true }).click();

      // The tab opened, in English, listing what is saved.
      await expect(page.getByRole("button", { name: "+ New connection" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Nómina/ })).toBeVisible();
    });
  });
});
