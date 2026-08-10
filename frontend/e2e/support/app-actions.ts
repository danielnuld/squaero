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
 * ACCESSIBILITY GAP: tree rows are plain <div>s with an onClick — no
 * role="treeitem", no tabIndex — so they cannot be reached by keyboard or by a
 * screen reader, and getByRole cannot see them. They do carry title={nodeLabel},
 * which is at least something a user perceives, so that is what these locators
 * use. Fixing the tree is recorded as task 2.12.
 */
export async function openFixtureTable(app: App): Promise<void> {
  const { page, engine } = app;
  const row = (name: string) => page.getByTitle(name, { exact: true }).first();
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
 * ACCESSIBILITY GAP: the SQL editor's textbox has no accessible name, so it cannot
 * be told apart from the object filter by role — getByRole("textbox").first()
 * silently typed the query into the filter box. Until the editor gets an
 * aria-label (recorded as task 2.12) it is reached by its CodeMirror container.
 */
export async function runSql(page: Page, sql: string): Promise<void> {
  const editor = page.locator(".cm-content").first();
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
 * Puts the grid into edit mode and narrows it to the single row `id`, so that row's
 * cells are the only ones on screen.
 *
 * ACCESSIBILITY GAP: an editable cell is a textbox with no accessible name, so
 * there is no way to ask for "the nombre cell of row 1". Filtering down to one row
 * first makes the remaining two textboxes unambiguous without depending on grid
 * geometry. Labelling the cells is recorded as task 2.12.
 */
export async function editRow(page: Page, nameFragment: string): Promise<void> {
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  // Filtering is by substring, so an id of "1" also matches 11, 12, 21… — narrow on
  // a name fragment instead, and one that survives the edit so the row does not
  // vanish from under the test halfway through.
  await page.getByRole("searchbox", { name: "Filtrar por nombre" }).fill(nameFragment);
  // Identify the cell by the value it holds rather than by a position: counting
  // textboxes was wrong twice already (the object filter and the SQL editor are
  // textboxes too), and an index would break again the next time the chrome
  // changes.
  await expect(nombreCell(page)).toHaveValue(new RegExp(nameFragment));
}

/**
 * The `nombre` cell of the single row `editRow` narrowed to.
 *
 * Restricted to real <input> elements: by role, the SQL editor is a textbox too —
 * it is a contenteditable, and on Informix it rendered after the grid, so "the last
 * textbox" grabbed it and the assertion failed with "Not an input element". That was
 * the fourth positional assumption to bite in this file, which is the argument for
 * the grid exposing cell roles (task 2.12). Until it does, editRow asserts this
 * element's value, so picking the wrong one fails loudly instead of quietly editing
 * something else.
 */
export function nombreCell(page: Page) {
  return page.locator("input").last();
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
