// Colour per data type in the grid (issue #483), through the real interface.
//
// The claim is visual, so the case reads the colour the browser actually
// computed: a text cell and a number cell must not be drawn in the same ink, and
// switching the setting off must put them both back to plain text. Asserting the
// class names instead would pass with a stylesheet that defines nothing.

import { connect, openFixtureTable } from "./support/app-actions";
import { describeEngine, test, expect } from "./support/fixtures";

type Page = import("@playwright/test").Page;

const inkOf = async (page: Page, selector: string): Promise<string> => {
  const cell = page.locator(selector).first();
  // The grid arrives when the query does, which on a cold connection is slower
  // than the default action timeout.
  await cell.waitFor({ state: "visible", timeout: 20_000 });
  return cell.evaluate((el) => getComputedStyle(el).color);
};

/** Back to the tab holding the data: settings opens as a tab of its own, and
    the first tab is the empty query the app starts with. */
const backToData = async (page: Page) => {
  await page.getByRole("tab", { name: "e2e_items" }).click();
};

const openSettings = async (page: Page) => {
  await page.getByRole("button", { name: "Ajustes" }).click();
  await expect(page.getByText("Colorear los datos por tipo")).toBeVisible();
};

describeEngine("sqlite", () => {
  test("draws each type in its own colour, and the switch puts it back", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    const text = await inkOf(page, ".cell-text");
    const number = await inkOf(page, ".cell-number");
    expect(text).not.toBe(number);

    // Off: every cell is the ordinary ink again.
    await openSettings(page);
    await page.getByLabel("Colorear los datos por tipo").uncheck();
    await backToData(page);

    expect(await inkOf(page, ".cell-text")).toBe(await inkOf(page, ".cell-number"));
  });

  test("a colour picked by the user wins over the theme's", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await openFixtureTable(app);

    await openSettings(page);
    // The swatch is a native colour input: set it and fire the event the app
    // listens to, which is what a real pick does.
    await page.getByLabel("Texto", { exact: true }).evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "#ff0000";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await backToData(page);

    expect(await inkOf(page, ".cell-text")).toBe("rgb(255, 0, 0)");
  });
});
