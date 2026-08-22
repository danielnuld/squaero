// Records the landing page's demo video: site/video/quaero-demo.{webm,mp4} and its
// poster. Run with `pnpm video`, which captures here and then encodes with ffmpeg
// (e2e/media/build-video.mjs). Needs the demo container:
//
//   docker start quaero-demo-mysql
//
// It follows the script documented in docs/SITE.md — connect, explore, query,
// tools — against the REAL core, the real MySQL driver and the versioned demo
// database. The previous video was driven by a puppeteer harness with a SIMULATED
// bridge, which meant nothing on screen had to actually work; here every row and
// every diagram comes back from a database, so the video cannot show something the
// product does not do.
//
// Playwright records the page itself, so the motion is real: the typing, the panels
// opening, the grid filling. The pauses are deliberate — a viewer needs a beat to
// read each step, and this plays muted on a loop with no narration, which is what
// the injected captions are for.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { installBridge } from "../support/bridge";
import { DEMO_CONNECTION, seedDemo } from "../support/demo";
import { seedBrowserState } from "../support/state";

const SIZE = { width: 1360, height: 860 };
const SITE_VIDEO = join(import.meta.dirname, "..", "..", "..", "site", "video");

/** Where the raw recording lands; build-video.mjs encodes from it. */
export const RAW = join(SITE_VIDEO, ".raw.webm");

test.use({ video: { mode: "on", size: SIZE }, viewport: SIZE });

test("record the demo video", async ({ page }) => {
  mkdirSync(SITE_VIDEO, { recursive: true });
  const rpc = await seedDemo();

  try {
    await installBridge(page, rpc);
    await seedBrowserState(page, { locale: "es", connections: [] });
    // Theme and connection are seeded as init scripts so the recording opens
    // straight into the app. Setting them afterwards would cost a second
    // navigation, and the reload is visible in a video in a way it is not in a
    // screenshot.
    await page.addInitScript(
      ({ conn }) => {
        localStorage.setItem("quaero.connections", JSON.stringify([conn]));
        localStorage.setItem("quaero.theme", "dark");
      },
      { conn: DEMO_CONNECTION },
    );

    /**
     * Shows a caption over the app.
     *
     * The video is muted and loops, so the captions are the only narration. They
     * are injected into the page instead of being burned in by ffmpeg afterwards,
     * which keeps them in sync with what they describe for free.
     */
    const caption = (text: string) =>
      page.evaluate((msg) => {
        let el = document.getElementById("__demo_caption");
        if (!el) {
          el = document.createElement("div");
          el.id = "__demo_caption";
          el.style.cssText = [
            "position:fixed",
            "left:50%",
            // Above the status bar and the results footer, so it never covers a
            // row count or a message the viewer is meant to read.
            "bottom:64px",
            "transform:translateX(-50%)",
            "z-index:2147483647",
            "background:rgba(18,18,24,.93)",
            "color:#fff",
            "font:600 18px/1.35 system-ui,'Segoe UI',sans-serif",
            "letter-spacing:.005em",
            "padding:11px 20px",
            "border-radius:11px",
            "box-shadow:0 10px 34px rgba(0,0,0,.5)",
            // Never intercept a click: the caption sits over the app while the
            // demo keeps driving it.
            "pointer-events:none",
            "transition:opacity .18s ease",
          ].join(";");
          document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.opacity = msg === "" ? "0" : "1";
      }, text);

    /** A beat, so a viewer can read the caption and see what changed. */
    const beat = (ms: number) => page.waitForTimeout(ms);

    const row = (name: string) =>
      page.getByRole("treeitem", { name, exact: true }).first();

    // --- 1. Connect ---------------------------------------------------------
    await page.goto("/");
    await expect(page.getByText("Sin conexión")).toBeVisible();
    await caption("Conecta a SQLite, MySQL, PostgreSQL, Informix o MongoDB");
    await beat(1600);

    await page.getByRole("button", { name: "Elegir conexión" }).click();
    await page.getByRole("button", { name: /Nueva conexión/ }).waitFor();
    await beat(700);
    await page.getByRole("button", { name: /Ventas \(demo\)/ }).click();
    await page.getByRole("button", { name: "Desconectar" }).waitFor();
    await beat(900);

    // --- 2. Explore --------------------------------------------------------
    await caption("Explora tablas, vistas, rutinas, triggers y eventos");
    await row("ventas").click();
    await row("Tablas").waitFor();
    await beat(500);
    await row("Tablas").click();
    await row("clientes").waitFor();
    await beat(600);
    // Scroll the demo database to the top: MySQL always lists information_schema,
    // mysql, performance_schema and sys above it, and no caption is about those.
    await page.locator('[aria-label="ventas"]').first().evaluate((el) => {
      el.scrollIntoView({ block: "start" });
    });
    await beat(700);

    // The structure comes from the tree's own context menu rather than a
    // double-click — which opens the same tab, but a dblclick also fires the two
    // single clicks under it, so the demo ended up with four tabs of the same table
    // stacked in the strip.
    await caption("Cada objeto lleva sus acciones encima");
    await row("clientes").click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await beat(1100);
    await caption("Columnas, tipos y el DDL de la tabla");
    await menu.getByRole("menuitem", { name: "Ver estructura" }).click();
    await expect(page.getByText(/CREATE TABLE/i).first()).toBeVisible({ timeout: 20_000 });
    await beat(2200);

    // --- 3. Query ----------------------------------------------------------
    await caption("Escribe SQL con autocompletado por esquema");
    await page.getByRole("button", { name: "Nueva consulta", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Editor SQL", exact: true });
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    // Typed rather than pasted, because the typing is the point of this beat.
    await page.keyboard.type(
      "SELECT nombre, ciudad, saldo FROM clientes\n  WHERE activo = 1 AND saldo > 500\n  ORDER BY saldo DESC",
      { delay: 26 },
    );
    await beat(900);
    await page.keyboard.press("Escape");

    await caption("Resultados tipados, editables y paginados");
    await page.getByRole("button", { name: "Ejecutar", exact: true }).click();
    await expect(page.getByText("Miguel Ángel").first()).toBeVisible();
    await beat(1200);

    // The poster is taken here, not cut from a frame: the site's <video> falls back
    // to this image, and what it promises is a query with its results.
    await caption("");
    await beat(300);
    await page.screenshot({ path: join(SITE_VIDEO, "quaero-demo-poster.png") });
    await caption("Resultados tipados, editables y paginados");
    await beat(700);

    // --- 4. Tools ----------------------------------------------------------
    const ribbon = page.getByRole("toolbar", { name: "Acciones" });

    await caption("Diagrama ER con las llaves foráneas reales");
    await ribbon.getByRole("button", { name: "Diagrama ER", exact: true }).click();
    await expect(page.getByText(/relaci[óo]n\(es\)/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await beat(2400);
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();

    await caption("Y un constructor visual, para armar la consulta sin escribirla");
    await ribbon
      .getByRole("button", { name: "Constructor de consultas", exact: true })
      .click();
    await expect(page.getByText(/columnas/i).first()).toBeVisible({ timeout: 30_000 });
    await beat(2400);

    // Fade the caption before the loop restarts, so the last frame and the first
    // do not slam two different sentences together.
    await caption("");
    await beat(700);
  } finally {
    await rpc.close();
  }

  // The recording is only finished once the page is closed.
  const video = page.video();
  if (!video) throw new Error("no video recorded: is `video` enabled in the config?");
  await page.close();
  await video.saveAs(RAW);
});
