// Regenerates the published screenshots (issue #753): assets/media/*.png, the
// sources the README, the site and the manual are made from (docs/SITE.md).
//
//   pnpm media        (needs the demo MySQL: docker start quaero-demo-mysql)
//
// which then runs scripts/site-images.mjs for the AVIF/WebP copies in site/img/.
//
// One test per image, each on a fresh page, so one broken screen costs its own
// picture and not the rest of the set. The data comes from e2e/support/demo.ts and
// the shared steps from e2e/support/media.ts, so the set can be shot again after a
// redesign with nothing but labels to update.
//
// Not shot: MongoDB, the iPhone app and the MCP server, which a MySQL demo in a
// desktop window cannot show, and a reconnect, which needs the server killed.

import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { DEMO_CONNECTION, seedDemo } from "../support/demo";
import {
  MEDIA_DIR,
  connectDemo,
  openDemoTable,
  openMedia,
  openTool,
  runEditor,
  runQuery,
  shot,
  sqlEditor,
  typeSql,
  treeRow,
  type MediaOptions,
  type StyleId,
} from "../support/media";
import { newQuery, pick } from "../support/app-actions";
import type { RpcClient } from "../support/rpc";


let rpc: RpcClient;

test.beforeAll(async () => {
  mkdirSync(MEDIA_DIR, { recursive: true });
  rpc = await seedDemo();
});

test.afterAll(async () => {
  await rpc?.close();
});

const ORDERS_SQL = [
  "SELECT c.nombre, c.ciudad, p.fecha, p.estado, p.total",
  "FROM clientes c",
  "JOIN pedidos p ON p.cliente_id = c.id",
  "ORDER BY p.fecha DESC",
].join("\n");

/** The working window: the tree open on the demo, a table tab and a query with its result. */
async function mainWindow(page: Page): Promise<void> {
  await openDemoTable(page);
  await runQuery(page, ORDERS_SQL, "Miguel Ángel");
}

// --- the main window, once per style: the README and the site's style picker ---

const STYLES: StyleId[] = ["nativo", "quiet", "editorial", "rosa"];
for (const style of STYLES) {
  test(`main window, ${style}`, async ({ page }) => {
    await openMedia(page, rpc, { style });
    await mainWindow(page);
    await shot(page, `screenshot-main-${style}`);
  });
}

// --- 1. Primeros pasos ---------------------------------------------------------

test("initial screen", async ({ page }) => {
  await openMedia(page, rpc);
  await expect(page.getByText("Sin conexión").first()).toBeVisible();
  await shot(page, "screenshot-initial");
});

test("settings, the four styles", async ({ page }) => {
  await openMedia(page, rpc);
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Apariencia", exact: true }).click();
  await expect(page.getByText("A · Quiet pro").first()).toBeVisible();
  await shot(page, "screenshot-settings-styles");
});

/** A saved list that looks like someone's: production in red, protected, grouped. */
const SAVED_CONNECTIONS: MediaOptions["connections"] = [
  DEMO_CONNECTION,
  {
    id: "demo-prod",
    name: "Ventas (producción)",
    driver: "mysql",
    params: { host: "db.ventas.example", port: "3306", user: "lectura", database: "ventas" },
    color: "#e5484d",
    group: "Producción",
    safeMode: "readOnly",
  },
  {
    id: "demo-inventario",
    name: "Inventario local",
    driver: "sqlite",
    params: { path: "C:/datos/inventario.db" },
    color: "#4bb45e",
  },
];

// --- 2. Conexiones: the manager's row menu, then the undo a delete leaves -------

test("connection manager, row menu and undo", async ({ page }) => {
  await openMedia(page, rpc, { connections: SAVED_CONNECTIONS });
  await page.getByRole("button", { name: "Conexiones", exact: true }).click();
  await page.getByRole("button", { name: "Más acciones: Ventas (demo)" }).click();
  await expect(page.getByRole("menuitem", { name: "Eliminar…" })).toBeVisible();
  await shot(page, "screenshot-connections-menu");

  await page.getByRole("menuitem", { name: "Eliminar…" }).click();
  await expect(page.getByText("Conexión «Ventas (demo)» eliminada")).toBeVisible();
  await expect(page.getByRole("button", { name: "Deshacer" })).toBeVisible();
  await shot(page, "screenshot-connections-undo");
});

// --- 3. Trabajar sin riesgos ----------------------------------------------------

test("protected connection asks before writing", async ({ page }) => {
  await openMedia(page, rpc, {
    connections: [{ ...DEMO_CONNECTION, safeMode: "confirm", color: "#e5484d" }],
  });
  await openDemoTable(page, "productos", "Teclado mecánico");
  await newQuery(page);
  await typeSql(page, "UPDATE productos SET existencias = existencias + 10 WHERE id = 4");
  await runEditor(page);
  const dialog = page.getByRole("dialog", { name: /Conexión protegida/ });
  await expect(dialog).toBeVisible();
  await shot(page, "screenshot-safe-mode");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
});

test("manual transaction pending", async ({ page }) => {
  await openMedia(page, rpc);
  await openDemoTable(page, "productos", "Teclado mecánico");
  await newQuery(page);
  await page.getByRole("button", { name: "Auto-commit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Transacción manual", exact: true })).toBeVisible();
  await typeSql(page, "UPDATE productos SET existencias = existencias - 1 WHERE id = 2");
  await runEditor(page);
  await expect(page.getByText(/En transacción · 1/).first()).toBeVisible();
  await shot(page, "screenshot-manual-tx");
  // Leave the demo as it was for the shots after this one.
  await page.getByRole("button", { name: "Revertir", exact: true }).first().click();
  await expect(page.getByText(/En transacción/)).toHaveCount(0);
});

// --- 4. Explorar: search a text across the schema --------------------------------

test("data search across the schema", async ({ page }) => {
  await openMedia(page, rpc);
  await connectDemo(page);
  await openTool(page, "Buscar en los datos");
  await page.getByLabel("Texto:").fill("pe");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByRole("status").getByText(/Terminado/)).toBeVisible({ timeout: 30_000 });
  await shot(page, "screenshot-data-search");
});

// --- 5. Consultar: the visual query builder --------------------------------------

test("query builder", async ({ page }) => {
  await openMedia(page, rpc);
  await openDemoTable(page);
  await openTool(page, "Constructor de consultas");
  await expect(page.getByText(/columnas/i).first()).toBeVisible({ timeout: 30_000 });
  for (const col of ["nombre", "ciudad", "saldo"]) {
    await page.getByRole("checkbox", { name: col, exact: true }).check();
  }
  await shot(page, "screenshot-builder");
});

// --- 6. El editor: completion and a diagnostic ------------------------------------

test("editor completion", async ({ page }) => {
  await openMedia(page, rpc);
  await openDemoTable(page);
  await newQuery(page);
  await sqlEditor(page).click();
  await page.keyboard.type(
    "SELECT c.nombre, p.total\nFROM clientes c\nJOIN pedidos p ON p.cliente_id = c.id\nWHERE c.",
  );
  const popup = page.getByRole("listbox");
  await expect(popup.getByRole("option", { name: /ciudad/ })).toBeVisible();
  await shot(page, "screenshot-editor-completion");
});

test("editor diagnostic", async ({ page }) => {
  await openMedia(page, rpc);
  await openDemoTable(page, "productos", "Teclado mecánico");
  await newQuery(page);
  // A comment first, so the hint over the UPDATE line does not cover the tabs.
  await typeSql(page, "-- Subir los precios un 5 %\nUPDATE productos\nSET precio = precio * 1.05");
  await sqlEditor(page).getByText("UPDATE").hover();
  await expect(page.getByText("UPDATE sin WHERE modifica todas las filas")).toBeVisible();
  await shot(page, "screenshot-editor-diagnostic", { keepPointer: true });
});

// --- 7. Datos: pin and compare, selection summary, transposed view, chart --------

test("pinned result compared with a new one", async ({ page }) => {
  await openMedia(page, rpc);
  await connectDemo(page);
  await runQuery(page, "SELECT id, nombre, precio, existencias FROM productos ORDER BY id", "Monitor 27\"");
  await page.getByRole("button", { name: "Fijar resultado" }).click();
  // The "new" result: two prices changed, one product gone, one added — what a
  // re-run after somebody's update would bring, without touching the demo data.
  await runQuery(
    page,
    [
      "SELECT id, nombre,",
      "  CASE WHEN id IN (2, 5) THEN ROUND(precio * 0.9, 2) ELSE precio END AS precio,",
      "  existencias",
      "FROM productos WHERE id <> 4",
      "UNION ALL SELECT 9, 'Soporte para monitor', 650.00, 15",
      "ORDER BY id",
    ].join("\n"),
    "Soporte para monitor",
  );
  await page.getByRole("toolbar", { name: "Acciones del objeto" }).getByRole("button", { name: "Comparar con…" }).click();
  await page.getByRole("menu").getByRole("menuitem").first().click();
  await expect(page.getByRole("toolbar", { name: "Comparación de resultados" })).toBeVisible();
  await shot(page, "screenshot-compare-results");
});

test("selection summary in the status bar", async ({ page }) => {
  await openMedia(page, rpc);
  await openDemoTable(page);
  const grid = page.getByRole("grid");
  await grid.getByRole("gridcell", { name: "1250.00", exact: true }).click();
  await grid.getByRole("gridcell", { name: "640.00", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByRole("contentinfo").getByText(/Suma/)).toBeVisible();
  await shot(page, "screenshot-selection-summary");
});

test("transposed view", async ({ page }) => {
  await openMedia(page, rpc);
  await openDemoTable(page);
  for (const n of [1, 2, 4, 8]) await page.getByRole("checkbox", { name: `Marcar la fila ${n}`, exact: true }).check();
  await page.getByRole("button", { name: "Transponer" }).click();
  await expect(page.getByRole("grid").getByText("Miguel Ángel")).toBeVisible();
  await expect(page.getByRole("grid").getByText("Juan Pérez")).toBeVisible();
  await shot(page, "screenshot-transpose");
});

test("chart of a result", async ({ page }) => {
  await openMedia(page, rpc);
  await connectDemo(page);
  await runQuery(
    page,
    "SELECT ciudad, COUNT(*) AS clientes, SUM(saldo) AS saldo\nFROM clientes GROUP BY ciudad ORDER BY clientes DESC",
    "Hermosillo",
  );
  await page.getByRole("button", { name: "Graficar" }).click();
  // The chart draws into a canvas, so wait for one of its own labels.
  await expect(page.getByText(/eje \(etiquetas\)/i).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "screenshot-charts");
});

// --- 9 & 10. Diseñar y administrar, vigilar el servidor ---------------------------

const TOOLS: [string, string, RegExp][] = [
  // Case-insensitive: several labels are uppercased by CSS, so the rendered text
  // and the DOM text differ.
  ["Diagrama ER", "screenshot-er", /relaci[óo]n\(es\)/i],
  ["Monitor de servidor", "screenshot-monitor", /sesi[óo]n\(es\)/i],
  ["Usuarios y permisos", "screenshot-users", /usuario\(s\)/i],
];
for (const [tool, file, ready] of TOOLS) {
  test(tool, async ({ page }) => {
    await openMedia(page, rpc);
    await openDemoTable(page);
    await openTool(page, tool);
    // Wait for the panel's DATA, not its tab: it arrives over the bridge, with no
    // network activity to wait on, and an ER diagram was once shot "Cargando…".
    await expect(page.getByText(ready).first()).toBeVisible({ timeout: 30_000 });
    if (tool === "Usuarios y permisos") {
      // A user's grants, rather than an empty "pick a user" pane.
      // vendedor is the demo's own account (demo.ts), with grants on `ventas`.
      await page.getByText("vendedor", { exact: true }).click();
      await expect(page.getByText(/GRANT .*INSERT/).first()).toBeVisible();
    }
    await shot(page, file);
  });
}

// --- 11. Comparar y mover entre bases ---------------------------------------------

test("schema compare with migration script", async ({ page }) => {
  await openMedia(page, rpc);
  await openDemoTable(page);
  await page.getByRole("toolbar", { name: "Acciones del objeto" }).getByRole("button", { name: "Más acciones" }).click();
  await page.getByRole("menuitem", { name: "Sincronizar estructura…" }).click();
  // The target is the same server, the older copy of the schema.
  await pick(page.getByLabel("Destino:"), "Ventas (demo)");
  await page.getByLabel("Base de datos:").nth(1).fill("ventas_v1");
  await page.getByRole("button", { name: "Comparar", exact: true }).click();
  await expect(page.getByText(/SQL de migración/).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "screenshot-schema-compare");
});

test("DDL dump to a folder", async ({ page }) => {
  // A folder the page can write to without a dialog: the File System Access API
  // in memory. The dump itself, the listing and the file contents are the app's.
  await page.addInitScript(() => {
    const dir = (name: string): unknown => ({
      name,
      getDirectoryHandle: async (n: string) => dir(n),
      getFileHandle: async () => ({
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      }),
    });
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => dir("ventas-ddl");
  });
  await openMedia(page, rpc);
  await connectDemo(page);
  await treeRow(page, "ventas").click();
  await openTool(page, "Respaldo y restauración");
  await page.getByRole("button", { name: "Volcar DDL a una carpeta…" }).click();
  await expect(page.getByText(/archivo\(s\) escritos en ventas-ddl/)).toBeVisible({ timeout: 30_000 });
  await shot(page, "screenshot-ddl-dump");
});
