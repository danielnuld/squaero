// Manual transactions in the editor (issue #667), through the real interface.
//
// The claim worth a real engine: in manual mode a change the editor ran is NOT
// in the database until Commit — another connection does not see it, Rollback
// throws it away, and Commit makes it stick. A fake core would only prove that
// tx.* was called.

import { connect, newQuery, runSql, readNombre } from "./support/app-actions";
import { describeAllEngines, test, expect } from "./support/fixtures";

describeAllEngines(["sqlite", "postgres", "mysql"], () => {
  test("a change made in manual mode waits for Commit, and Rollback discards it", async ({
    app,
  }) => {
    const { page } = app;
    await app.open();
    await connect(app);
    await newQuery(app.page);

    await page.getByRole("button", { name: "Auto-commit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Transacción manual", exact: true })).toBeVisible();

    await runSql(page, "UPDATE e2e_items SET nombre = 'Pendiente' WHERE id = 1");
    const open = page.getByRole("status").filter({ hasText: "En transacción · 1" });
    await expect(open).toBeVisible({ timeout: 20_000 });
    // Not committed: another connection still reads the old value.
    expect(await readNombre(app, 1)).toBe("Nogales");

    await page.getByRole("button", { name: "Revertir", exact: true }).click();
    await expect(open).toHaveCount(0);
    expect(await readNombre(app, 1)).toBe("Nogales");

    await runSql(page, "UPDATE e2e_items SET nombre = 'Confirmado' WHERE id = 1");
    await expect(page.getByRole("status").filter({ hasText: "En transacción · 1" })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect.poll(() => readNombre(app, 1), { timeout: 15_000 }).toBe("Confirmado");
  });
});
