// Importing the connection list of another tool, through the real interface
// (issue #391).
//
// The unit tests pin the two readers; what this one defends is the road between
// a file on disk and a connection you can click: the same Importar button, the
// format recognised by content, and the whole connection saved — password
// included, which is the difference between importing a list and importing
// something you can actually open.

import { describeEngine, expect, test } from "./support/fixtures";

const DBEAVER = JSON.stringify({
  connections: {
    "postgres-jdbc-18f2": {
      provider: "postgresql",
      name: "Ventas prod",
      folder: "Producción",
      configuration: {
        host: "db.example.com",
        port: "5432",
        database: "ventas",
        user: "app",
        password: "hunter2",
      },
    },
    "oracle-77": {
      provider: "oracle",
      name: "Cobranza",
      configuration: { host: "orcl.example.com" },
    },
  },
});

const NAVICAT = `<?xml version="1.0" encoding="UTF-8"?>
<Connections>
  <!-- Password as Navicat 12 writes it: AES-CBC with libcc's key and IV, hex.
       This blob decrypts to "s3cr3t". -->
  <Connection ConnectionName="SIAJ" ConnType="MySQL" Host="10.0.0.9" Port="3306"
              UserName="root" Password="4018F6BA8332DF93F3310351960A3184" Database="siaj"/>
</Connections>`;

describeEngine("sqlite", () => {
  // Nothing pre-saved: importing into an empty list is the migration case.
  test.use({ seedConnection: false });

  /**
   * Opens the connections tab, where importing lives since #525 — the bar's +
   * opens a search for OPENING a connection, and the file picker moved to the
   * tab with the rest of what outlives a session. Reached from the tool strip,
   * which keeps this one tool enabled with nothing connected.
   */
  const openManager = (page: import("@playwright/test").Page) =>
    page
      .getByRole("toolbar", { name: "Acciones" })
      .getByRole("button", { name: "Conexiones", exact: true })
      .click();

  /** Hands `text` to the manager's hidden file input under `name`. */
  const importFile = async (
    page: import("@playwright/test").Page,
    name: string,
    text: string,
  ) => {
    await page.locator('.conn-io input[type="file"]').setInputFiles({
      name,
      mimeType: name.endsWith(".ncx") ? "text/xml" : "application/json",
      buffer: Buffer.from(text, "utf8"),
    });
  };

  test("reads a DBeaver file and says what it could not bring", async ({ app }) => {
    const { page } = app;
    await app.open();

    // The empty list is where a newcomer is told this is possible at all.
    await openManager(page);
    await expect(page.getByText(/data-sources\.json de DBeaver/)).toBeVisible();

    await importFile(page, "data-sources.json", DBEAVER);

    // The summary names the tool, the password rule, and the engine it dropped.
    const msg = page.getByText(/DBeaver:/);
    await expect(msg).toBeVisible();
    await expect(msg).toContainText("1 con contraseña");
    await expect(msg).toContainText("oracle");

    await expect(page.getByRole("button", { name: /Ventas prod/ })).toBeVisible();
    // Oracle is not a connection we can honour, so it is not on the list.
    await expect(page.getByRole("button", { name: /Cobranza/ })).toHaveCount(0);
  });

  test("reads a Navicat .ncx, password included", async ({ app }) => {
    const { page } = app;
    await app.open();
    await openManager(page);
    await importFile(page, "servers.ncx", NAVICAT);

    await expect(page.getByRole("button", { name: /SIAJ/ })).toBeVisible();

    // Straight out of storage: the whole connection arrived, decrypted.
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("quaero.connections") ?? "[]"),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: "SIAJ",
      driver: "mysql",
      params: {
        host: "10.0.0.9",
        port: "3306",
        database: "siaj",
        user: "root",
        password: "s3cr3t",
      },
    });
    // The ciphertext itself is never what gets stored.
    expect(JSON.stringify(saved)).not.toContain("4018F6BA");
  });
});
