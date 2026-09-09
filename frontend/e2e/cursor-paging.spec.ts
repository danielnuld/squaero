// Paging a query with the cursor the core keeps open, and exporting past the
// page on screen (issues #478, #479), through the real interface and real core.
//
// The claim being tested is the one that justifies the change: the second page
// must NOT execute the query again. Asserting that the rows moved is not enough
// — a page that silently re-ran the query shows exactly the same rows, which is
// the behaviour this replaced. So the case counts what the page sends over the
// bridge. It caught the real bug once already: the interface's own catalog
// queries were dropping the cursor, and every page turn fell back to re-running
// the query while looking perfectly correct on screen.

import { readFileSync } from "node:fs";

import { connect, runSql } from "./support/app-actions";
import { bulkFill } from "./support/seed";
import { describeAllEngines, test, expect } from "./support/fixtures";

type Page = import("@playwright/test").Page;
interface SentCall {
  method: string;
  sql?: string;
}

/** Record every JSON-RPC call the page sends from here on. */
async function recordRpc(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window as unknown as {
      quaeroRpc: (raw: string) => Promise<unknown>;
      __sent?: { method: string; sql?: string }[];
    };
    const inner = host.quaeroRpc;
    host.__sent = [];
    host.quaeroRpc = (raw: string) => {
      try {
        const req = JSON.parse(raw) as { method: string; params?: { sql?: string } };
        host.__sent?.push({ method: req.method, sql: req.params?.sql });
      } catch {
        /* not our business: the bridge still gets the call */
      }
      return inner(raw);
    };
  });
}

const sent = (page: Page): Promise<SentCall[]> =>
  page.evaluate(() => (window as unknown as { __sent: SentCall[] }).__sent);

const QUERY = "SELECT id, nombre FROM e2e_items ORDER BY id";

/** How many rows the table really holds, asked of the engine directly. */
async function countRows(app: {
  rpc: import("./support/rpc").RpcClient;
  engine: { driver: string; dsn: Record<string, string> };
}): Promise<number> {
  const opened = (await app.rpc.call("conn.open", {
    driver: app.engine.driver,
    dsn: app.engine.dsn,
  })) as { result?: { connId?: string } };
  const connId = opened.result?.connId;
  if (connId === undefined) throw new Error("could not open a connection to count the rows");
  try {
    const res = (await app.rpc.call("query.run", {
      connId,
      sql: "SELECT COUNT(*) AS n FROM e2e_items",
    })) as { result?: { rows?: string[][] } };
    return Number(res.result?.rows?.[0]?.[0]);
  } finally {
    await app.rpc.call("conn.close", { connId });
  }
}

// Every engine: the cursor lives in the core, but what each driver does with an
// open result differs (MySQL buffers it whole, SQLite keeps a live statement).
describeAllEngines(["sqlite", "mysql", "postgres", "informix"], () => {
  test("the second page continues the cursor instead of re-running the query", async ({ app }) => {
    // The grid pages at 1000 rows, so the base fixture would never reach page 2.
    await bulkFill(app.rpc, app.engine.name);

    const { page } = app;
    await app.open();
    await connect(app);
    await recordRpc(page);

    await runSql(page, QUERY);
    await expect(page.getByText(/Filas 1–1000/)).toBeVisible({ timeout: 20_000 });

    const next = page.getByRole("button", { name: /Siguiente/ });
    const previous = page.getByRole("button", { name: /Anterior/ });
    await expect(next).toBeEnabled();

    await next.click();
    await expect(page.getByText(/Filas 1001–/)).toBeVisible({ timeout: 20_000 });

    const afterNext = await sent(page);
    expect(afterNext.filter((c) => c.method === "query.next")).toHaveLength(1);
    // The query itself ran ONCE for both pages. The interface fires catalog
    // queries of its own (foreign keys, completions) down the same connection
    // in between, and those must not cost the user the cursor.
    expect(afterNext.filter((c) => c.sql === QUERY)).toHaveLength(1);

    // And back: a cursor only moves forward, so page 1 comes from memory.
    const before = afterNext.length;
    await previous.click();
    await expect(page.getByText(/Filas 1–1000/)).toBeVisible();
    expect(await sent(page)).toHaveLength(before);
  });

  test("exporting writes every row, not the page on screen", async ({ app }) => {
    await bulkFill(app.rpc, app.engine.name);

    const { page } = app;
    // Force the download fallback: the native save dialog cannot be driven from a
    // test, and what is being checked is the content, not which dialog opened.
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    });
    await app.open();
    await connect(app);

    await runSql(page, QUERY);
    await expect(page.getByText(/Filas 1–1000/)).toBeVisible({ timeout: 20_000 });

    const download = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: /Exportar/ }).click();
    await page.getByRole("menuitem", { name: "CSV" }).click();

    const file = await (await download).path();
    const lines = readFileSync(file, "utf8").trim().split("\n");

    // Exactly the table, plus the header row: what the grid had loaded was the
    // page cap, and the whole point is that the file went past it.
    const total = await countRows(app);
    expect(total).toBeGreaterThan(1000);
    expect(lines).toHaveLength(total + 1);
  });
});
