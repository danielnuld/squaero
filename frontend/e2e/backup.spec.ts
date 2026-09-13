// Backup and restore (#143): back the fixture table up through the panel, drop
// it, restore the file, and require the rows to come back exactly as they were.
//
// The save dialog is the one native piece the harness cannot drive, so the page's
// showSaveFilePicker is replaced by one that keeps what is written. Everything
// else — schema.ddl, the cursor walk, splitting the file, running it — is real.

import { connect } from "./support/app-actions";
import { describeAllEngines, expect, test } from "./support/fixtures";
import type { App } from "./support/fixtures";

/** Runs `sql` on a connection of the harness's own, outside the page. */
async function onCore(app: App, sql: string): Promise<(string | null)[][]> {
  const opened = await app.rpc.call("conn.open", { driver: app.engine.driver, dsn: app.engine.dsn });
  const connId = (opened.result as { connId: string }).connId;
  try {
    const res = await app.rpc.call("query.run", { connId, sql, limit: 5000 });
    if (res.error) throw new Error(`${sql}: ${res.error.message}`);
    return (res.result as { rows?: (string | null)[][] }).rows ?? [];
  } finally {
    await app.rpc.call("conn.close", { connId });
  }
}

describeAllEngines(["mysql", "postgres"], (name) => {
  test("a backup restores the table it was taken from", async ({ app }) => {
    const { page } = app;
    // A quote, a backslash and a semicolon: the three ways a dump breaks. MySQL
    // reads the backslash as an escape, so its literal spells it twice.
    const tricky = name === "mysql" ? "'C:\\\\new it''s; ok'" : "'C:\\new it''s; ok'";
    await onCore(app, `INSERT INTO e2e_items (id, nombre) VALUES (99, ${tricky})`);
    const select = "SELECT id, nombre FROM e2e_items ORDER BY id";
    const before = await onCore(app, select);
    expect(before.find((r) => r[0] === "99")?.[1]).toBe("C:\\new it's; ok");

    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__dump = "";
      w.showSaveFilePicker = async () => ({
        createWritable: async () => ({
          write: async (chunk: string) => {
            w.__dump = (w.__dump as string) + chunk;
          },
          close: async () => {},
        }),
      });
    });
    await app.open();
    await connect(app);

    await page
      .getByRole("toolbar", { name: "Acciones" })
      .getByRole("button", { name: "Respaldo y restauración", exact: true })
      .click();

    // PostgreSQL's database holds schemas, so the tables come once one is chosen.
    if (name === "postgres") await page.getByLabel("Esquema:").selectOption("public");
    const box = page.getByRole("checkbox", { name: "e2e_items", exact: true });
    await box.waitFor();
    await page.getByRole("button", { name: "Ninguno", exact: true }).click();
    await box.check();
    await page.getByRole("button", { name: "Respaldar…", exact: true }).click();
    await expect(page.getByText("Respaldo guardado: 1 objeto(s).")).toBeVisible();

    const dump = await page.evaluate(() => (window as unknown as { __dump: string }).__dump);
    expect(dump).toMatch(/CREATE TABLE/i);

    await onCore(app, "DROP TABLE e2e_items");

    await page.getByLabel("Archivo:").setInputFiles({
      name: "dump.sql",
      mimeType: "application/sql",
      buffer: Buffer.from(dump, "utf8"),
    });
    await expect(page.getByText(/dump\.sql: \d+ sentencia\(s\)/)).toBeVisible();
    await page.getByRole("button", { name: "Restaurar", exact: true }).click();
    await expect(page.getByText(/sentencia\(s\) ejecutada\(s\)\./)).toBeVisible({ timeout: 30_000 });

    expect(await onCore(app, select)).toEqual(before);
  });
});
