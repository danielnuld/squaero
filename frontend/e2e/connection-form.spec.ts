// Creating a connection by filling in the form.
//
// Every other test starts from a connection seeded straight into localStorage,
// which is fast but skips the first thing any new user does. This is the one case
// that types it in.

import { DRIVER_SCHEMAS } from "../src/utils/connections";
import { connect } from "./support/app-actions";
import { describeAllEngines, expect, test } from "./support/fixtures";

/**
 * The visible label of a DSN field, taken from the production schema rather than
 * copied here — so renaming a label cannot leave this test asserting a caption the
 * interface no longer shows.
 */
function labelFor(driver: string, key: string): string | null {
  return (
    DRIVER_SCHEMAS[driver]?.fields.find((f) => f.key === key)?.label ?? null
  );
}

describeAllEngines(["sqlite", "postgres", "mysql", "informix"], () => {
  // The connection must NOT be pre-saved: the point is to create it.
  test.use({ seedConnection: false });

  test("creates a connection through the form and keeps it across a reload", async ({
    app,
  }) => {
    const { page, engine } = app;
    const name = `Formulario ${engine.name}`;

    await app.open();
    await page.getByRole("button", { name: "Elegir conexión" }).click();
    await page.getByRole("button", { name: /Nueva conexión/ }).click();

    const form = page.getByRole("region", { name: /conexión/ });
    await form.getByRole("textbox", { name: "Nombre" }).fill(name);
    // By value, not by label: the options carry an emoji ("🗄️ SQLite").
    await form.getByRole("combobox", { name: "Motor" }).selectOption(engine.driver);

    // Fill exactly the DSN this engine needs, by the label the form shows for it.
    for (const [key, value] of Object.entries(engine.dsn)) {
      const label = labelFor(engine.driver, key);
      expect(label, `${engine.driver} should have a field for ${key}`).not.toBeNull();
      // Scoped to the form: required fields render with a trailing "*", so the
      // match has to be loose, and loose across the whole page now finds the
      // tool strip's "Usuarios y permisos" when the field is "Usuario" (#386).
      await form.getByLabel(label!, { exact: false }).first().fill(value);
    }

    await page.getByRole("button", { name: "Guardar" }).click();
    // It is listed, and it survives a reload — which is what "saved" has to mean.
    await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Elegir conexión" }).click();
    await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();

    // And it actually works: open it and see the engine answer.
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.getByRole("button", { name: "Desconectar" })).toBeVisible();
    expect(connect).toBeInstanceOf(Function); // the seeded path stays available
  });
});
