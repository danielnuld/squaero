// The handful of interface actions every critical-path test needs, written once.
//
// Locators go by role, accessible name or the tooltip a user sees — never by CSS
// class for identity, which breaks on the next refactor and tests nothing anyone
// can perceive. Where the interface has no accessible handle at all, it is noted
// here and recorded as accessibility work in the change's tasks.md rather than
// papered over.

import { expect, type Page } from "@playwright/test";

import type { App } from "./fixtures";

/** Opens the saved connection through the sidebar, as a user would. */
export async function connect(app: App): Promise<void> {
  const { page, engine } = app;
  await page.getByRole("button", { name: "Elegir conexión" }).click();
  // Wait for the popover itself, not for time: the list renders inside it.
  await page.getByRole("button", { name: /Nueva conexión/ }).waitFor();
  await page.getByRole("button", { name: new RegExp(engine.label) }).click();
  // "Desconectar" only exists once a connection is open, so it is the signal.
  await page.getByRole("button", { name: "Desconectar" }).waitFor();
}

export async function disconnect(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Desconectar" }).click();
}

/**
 * Expands the tree down to the fixture table and opens its data tab.
 *
 * Addressed by role and accessible name, now that the tree is a real ARIA tree of
 * treeitems. It used to need the rows' title attribute, because they were divs with
 * an onClick that no role could reach.
 */
export async function openFixtureTable(app: App): Promise<void> {
  const { page, engine } = app;
  const row = (name: string) =>
    page.getByRole("treeitem", { name, exact: true }).first();
  const table = row("e2e_items");

  // Expand only what is still closed: PostgreSQL opens its active database for
  // you, and clicking an expanded node would collapse it again.
  for (const container of engine.treePath) {
    if (await table.count()) {
      break;
    }
    await row(container).waitFor();
    await row(container).click();
  }

  await table.waitFor();
  await table.click();

  // The grid is up once the first fixture row is on screen.
  await expect(page.getByText("Nogales").first()).toBeVisible();
}

/**
 * Runs `sql` through the editor.
 *
 * By name, now that the editor has one. It used to be reached through its
 * CodeMirror container class, because by role it was indistinguishable from the
 * object filter — which is how queries ended up typed into the filter box.
 */
export async function runSql(page: Page, sql: string): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Editor SQL", exact: true });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(sql);
  // Typing opens the completion popup, which swallows the click on Ejecutar.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ejecutar", exact: true }).click();
}

/**
 * A cell holding exactly `value`.
 *
 * ACCESSIBILITY GAP: the result grid exposes no table/grid role and its cells no
 * roles either, so there is nothing to scope by except the value itself. Asserting
 * an exact string is the right thing for encoding regardless — `ñ` versus `Ã±` is
 * the whole difference between a fix and the look of one — but it means these
 * locators cannot say "in the grid". Recorded as task 2.12.
 */
export function cell(page: Page, value: string) {
  return page.getByText(value, { exact: true });
}

/**
 * Puts the grid into edit mode and narrows it to the single row matching
 * `nameFragment`, so that row's cells are the only ones on screen.
 */
export async function editRow(page: Page, nameFragment: string): Promise<void> {
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  // Filtering is by substring, so an id of "1" would also match 11, 12, 21… — narrow
  // on a name fragment instead, and one that survives the edit so the row does not
  // vanish from under the test halfway through.
  await page.getByRole("searchbox", { name: "Filtrar por nombre" }).fill(nameFragment);
  await expect(nombreCell(page)).toHaveValue(new RegExp(nameFragment));
}

/**
 * The `nombre` cell of the single row `editRow` narrowed to.
 *
 * Asked for by the column it belongs to, now that editable cells are labelled with
 * their column name. Four different positional guesses failed here before that —
 * counting textboxes without allowing for the object filter, then without the SQL
 * editor, then a fixed index, then "the last textbox", which on Informix grabbed
 * CodeMirror's contenteditable. All four were the same missing label.
 */
export function nombreCell(page: Page) {
  return page.getByRole("textbox", { name: "nombre", exact: true });
}

/** Reads a value straight from the database, to check what the UI really did. */
export async function readNombre(app: App, id: number): Promise<string | null> {
  const opened = await app.rpc.call("conn.open", {
    driver: app.engine.driver,
    dsn: app.engine.dsn,
  });
  const connId = (opened.result as { connId: string }).connId;
  try {
    const res = await app.rpc.call("query.run", {
      connId,
      sql: `SELECT nombre FROM e2e_items WHERE id = ${id}`,
      limit: 1,
    });
    const rows = (res.result as { rows: (string | null)[][] } | undefined)?.rows ?? [];
    return rows[0]?.[0] ?? null;
  } finally {
    await app.rpc.call("conn.close", { connId });
  }
}
