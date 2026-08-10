// The object tree has to be usable with no mouse at all.
//
// It used to be rows of <div> with an onClick: no role, no tabIndex. Anyone
// navigating by keyboard, or with a screen reader, simply could not reach the
// database objects — the whole left half of the product. These cases exist so that
// cannot regress silently.

import { connect } from "./support/app-actions";
import { describeEngine, expect, test } from "./support/fixtures";

describeEngine("sqlite", () => {
  test("reaches the fixture table using only the keyboard", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    const tree = page.getByRole("tree");
    await expect(tree).toBeVisible();

    // Focus the tree the way a keyboard user arrives at it, then walk down and open
    // each container with the arrow keys — no click anywhere.
    await tree.focus();
    await page.keyboard.press("ArrowDown");

    const active = async () => {
      const id = await tree.getAttribute("aria-activedescendant");
      return id === null ? null : page.locator(`#${id}`);
    };

    // The first item is the database node, closed.
    let row = await active();
    expect(row, "the tree publishes an active item").not.toBeNull();
    await expect(row!).toHaveAttribute("aria-label", "main");
    await expect(row!).toHaveAttribute("aria-expanded", "false");

    // Right opens it, and the child level appears.
    await page.keyboard.press("ArrowRight");
    await expect(row!).toHaveAttribute("aria-expanded", "true");

    // Step in, open the folder, step in again, and activate the table.
    await page.keyboard.press("ArrowDown");
    row = await active();
    await expect(row!).toHaveAttribute("aria-label", "Tablas");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    row = await active();
    await expect(row!).toHaveAttribute("aria-label", "e2e_items");

    await page.keyboard.press("Enter");

    // The table opened, by keyboard alone.
    await expect(page.getByText("Nogales", { exact: true })).toBeVisible();
  });

  test("collapses and steps back out with the left arrow", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    const tree = page.getByRole("tree");
    await tree.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight"); // open the database

    const dbNode = page.getByRole("treeitem", { name: "main", exact: true });
    await expect(dbNode).toHaveAttribute("aria-expanded", "true");

    // From a child, Left goes out to the parent rather than collapsing anything.
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("treeitem", { name: "Tablas", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(dbNode).toHaveAttribute("aria-selected", "true");

    // On the parent, Left collapses it.
    await page.keyboard.press("ArrowLeft");
    await expect(dbNode).toHaveAttribute("aria-expanded", "false");
  });

  test("exposes the tree and the grid with the roles they claim", async ({ app }) => {
    const { page } = app;
    await app.open();
    await connect(app);

    // Levels are reported, so a screen reader can say how deep an item sits.
    await expect(page.getByRole("treeitem", { name: "main" })).toHaveAttribute(
      "aria-level",
      "1",
    );

    await page.getByRole("treeitem", { name: "main", exact: true }).click();
    await page.getByRole("treeitem", { name: "Tablas", exact: true }).click();
    await page.getByRole("treeitem", { name: "e2e_items", exact: true }).click();

    // The result is a grid, and it reports the TOTAL row count rather than the
    // handful the virtual window happens to have rendered.
    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible();
    await expect(grid).toHaveAttribute("aria-rowcount", "29"); // 28 rows + header
    await expect(grid).toHaveAttribute("aria-colcount", "2");
    await expect(page.getByRole("row").first()).toHaveAttribute("aria-rowindex", "1");
  });
});
