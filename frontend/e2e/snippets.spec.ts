// The snippet library (issue #338), driven through the real interface.
//
// The promise under test is the one that made this refactor necessary: opening a
// saved snippet must never touch the query you were writing. Everything else here
// — one tab per snippet, the tab you came back to — exists to protect that.
//
// SQLite only: none of this reaches the database, and running it once against the
// engine that needs no container keeps the suite honest about what it covers.

import type { Page } from "@playwright/test";

import { connect } from "./support/app-actions";
import { describeEngine, test, expect, type App } from "./support/fixtures";
import { seedSnippets } from "./support/state";

const SNIPPETS = [
  { id: "snip-1", name: "artículos por ciudad", body: "SELECT ciudad FROM e2e_items" },
  { id: "snip-2", name: "conteo", body: "SELECT count(*) FROM e2e_items" },
];

describeEngine("sqlite", () => {
  /** Loads the interface with the set already saved. */
  async function openWithSnippets(app: App): Promise<void> {
    await seedSnippets(app.page, SNIPPETS);
    await app.open();
  }

  const editor = (page: Page) => page.getByRole("textbox", { name: "Editor SQL", exact: true });
  const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

  /** Opens the snippet palette and activates the first match for `name`. */
  async function openFromPalette(page: Page, name: string, key = "Enter"): Promise<void> {
    const palette = page.getByRole("dialog", { name: "Paleta de comandos" });
    await page.keyboard.press("ControlOrMeta+j");
    const search = palette.getByRole("textbox", { name: "Buscar comandos" });
    await search.waitFor();
    await search.fill(name);
    // The palette's rows are buttons; wait for the match to be the one highlighted
    // rather than pressing a key into a list that has not filtered yet.
    await palette.getByRole("button", { name, exact: true }).waitFor();
    await page.keyboard.press(key);
    await expect(palette).toBeHidden();
  }

  test("opening a snippet leaves the query you were writing alone", async ({ app }) => {
    const { page } = app;
    await openWithSnippets(app);

    await editor(page).click();
    await page.keyboard.type("SELECT lo_que_estaba_escribiendo");
    await page.keyboard.press("Escape"); // dismiss the completion popup

    await openFromPalette(page, "conteo");

    // A tab of its own, named after the snippet and holding its body.
    await expect(tab(page, "conteo")).toHaveAttribute("aria-selected", "true");
    await expect(editor(page)).toContainText("SELECT count(*) FROM e2e_items");

    // And the tab it was opened from still holds exactly what was typed there.
    await tab(page, "Consulta 1").click();
    await expect(editor(page)).toContainText("SELECT lo_que_estaba_escribiendo");
    await expect(editor(page)).not.toContainText("count(*)");
  });

  test("a snippet gets one tab, not one per opening", async ({ app }) => {
    const { page } = app;
    await openWithSnippets(app);

    await openFromPalette(page, "conteo");
    await tab(page, "Consulta 1").click();
    await openFromPalette(page, "conteo");

    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(tab(page, "conteo")).toHaveAttribute("aria-selected", "true");

    // A different snippet is a different tab.
    await openFromPalette(page, "artículos por ciudad");
    await expect(page.getByRole("tab")).toHaveCount(3);
  });

  test("Ctrl+Enter still drops a snippet at the cursor", async ({ app }) => {
    const { page } = app;
    await openWithSnippets(app);

    await editor(page).click();
    await page.keyboard.type("SELECT 1; ");
    await page.keyboard.press("Escape");

    await openFromPalette(page, "conteo", "ControlOrMeta+Enter");

    await expect(editor(page)).toContainText("SELECT 1; SELECT count(*) FROM e2e_items");
    await expect(page.getByRole("tab")).toHaveCount(1); // inserting opens nothing
  });

  test("the library searches by body, opens, and stays open for the next one", async ({ app }) => {
    const { page } = app;
    await openWithSnippets(app);
    // The tool strip only lights up with a connection open, so this is also the
    // one test that walks in through the front door.
    await connect(app);

    await page
      .getByRole("toolbar", { name: "Acciones" })
      .getByRole("button", { name: "Snippets", exact: true })
      .click();

    const rows = page.getByRole("button", { name: /^(conteo|artículos por ciudad)/ });
    await expect(rows).toHaveCount(2);

    // "count(*)" is in no name at all — searching what a query DOES is the point.
    await page.getByRole("searchbox", { name: "Buscar en tus snippets" }).fill("count(*)");
    await expect(rows).toHaveCount(1);

    await page.getByRole("button", { name: "Abrir", exact: true }).click();
    await expect(tab(page, "conteo")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "Snippets")).toBeVisible(); // left behind for the next one
  });

  test("an edit saved back survives a reload, without forking a copy", async ({ app }) => {
    const { page } = app;
    await openWithSnippets(app);
    await openFromPalette(page, "conteo");

    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("SELECT count(*) FROM e2e_items WHERE id > 2");
    await page.keyboard.press("Escape");

    // The tab says it is out of step with what is stored.
    await expect(tab(page, "conteo · con cambios sin guardar")).toBeVisible();

    // Ctrl+Shift+S offers this snippet's own name; accepting it saves back.
    await page.keyboard.press("ControlOrMeta+Shift+S");
    const name = page.getByRole("textbox", { name: "Nombre del snippet" });
    await expect(name).toHaveValue("conteo");
    // Typed, not filled: the field must already hold the caret. It did not, and
    // `name.press()` hid that by focusing first — so the name went into the query
    // and Enter inserted a newline, which only showed up in the native window.
    await expect(name).toBeFocused();
    // And it fits: the bar used to overflow its own pane, so the right half of
    // the field sat outside the window, unreadable and unclickable.
    expect(
      await page.evaluate(() => {
        const bar = document.querySelector(".editor-hint")!;
        return bar.scrollWidth - bar.clientWidth;
      }),
      "the editor bar does not overflow while naming",
    ).toBeLessThanOrEqual(0);
    await page.keyboard.press("Enter");
    await expect(tab(page, "conteo")).toBeVisible(); // the mark is gone

    // The seed only runs on the first load, so what comes back is what was stored.
    await page.reload();
    await openFromPalette(page, "conteo");
    await expect(editor(page)).toContainText("WHERE id > 2");

    // And there is still one "conteo", not a numbered second copy.
    await page.keyboard.press("ControlOrMeta+j");
    const palette = page.getByRole("dialog", { name: "Paleta de comandos" });
    await expect(palette.getByRole("button", { name: /^conteo/ })).toHaveCount(1);
  });

  test("arrows walk the tab list", async ({ app }) => {
    const { page } = app;
    await openWithSnippets(app);
    await openFromPalette(page, "conteo");

    await tab(page, "conteo").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "Consulta 1")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "conteo")).toHaveAttribute("aria-selected", "true");
  });
});
