// The harness is code, so it gets tested too.
//
// These cases assert the properties everything else rests on: the bridge really
// reaches the core, responses are matched by id rather than by arrival order, the
// browser starts from known state, and an unavailable engine is reported honestly.

import { readAvailability, isRequired, statusOf } from "./support/availability";
import { ENGINES } from "./support/engines";
import { test, expect, describeEngine } from "./support/fixtures";

test.describe("harness", () => {
  test("the bridge reaches the real core", async ({ rpc }) => {
    const res = await rpc.call("app.hello");
    expect(res.error, "app.hello should not error").toBeUndefined();
    expect(res.result).toBeDefined();
  });

  test("responses are matched by id, not by arrival order", async ({ rpc }) => {
    // Fire several calls without awaiting, then check each got ITS answer. The core
    // dispatches op.cancel without queueing it behind a running query, so responses
    // genuinely can arrive out of order; pairing by order would pass here only by
    // luck and fail intermittently later.
    const calls = [
      rpc.call("app.hello"),
      rpc.call("no.such.method"),
      rpc.call("app.hello"),
      rpc.call("no.such.method"),
    ];
    const [a, b, c, d] = await Promise.all(calls);

    expect(a.error, "first app.hello answered as itself").toBeUndefined();
    expect(b.error, "first bad method answered as itself").toBeDefined();
    expect(c.error, "second app.hello answered as itself").toBeUndefined();
    expect(d.error, "second bad method answered as itself").toBeDefined();
  });

  test("an unknown method fails without killing the bridge", async ({ rpc }) => {
    const bad = await rpc.call("definitely.not.a.method");
    expect(bad.error).toBeDefined();
    // The bridge must survive it: the next call still works.
    const good = await rpc.call("app.hello");
    expect(good.error).toBeUndefined();
  });

  test("every engine was probed and reported", () => {
    const probed = readAvailability();
    expect(
      probed.length,
      "globalSetup must run and record a verdict per engine",
    ).toBe(ENGINES.length);
    for (const engine of ENGINES) {
      const status = statusOf(engine.name);
      if (!status.available) {
        // An unavailable engine must say why. A blank reason is what turns a skip
        // into a mystery.
        expect(status.reason, `${engine.name} must explain why`).not.toBe("");
      }
    }
  });

  test("a nonexistent engine reports as unavailable rather than throwing", () => {
    // statusOf is what the skip decision rests on; asked about something it never
    // probed it must answer, not explode.
    const status = statusOf("sqlite");
    expect(typeof status.available).toBe("boolean");
    expect(isRequired("sqlite")).toBe(
      (process.env.QUAERO_E2E_REQUIRE ?? "").includes("sqlite"),
    );
  });
});

// The rest needs a browser, so it runs against whichever engine is cheapest:
// SQLite needs no container.
describeEngine("sqlite", () => {
  test("the interface loads with the bridge installed", async ({ app }) => {
    await app.open();
    const hasBridge = await app.page.evaluate(
      () => typeof (globalThis as { quaeroRpc?: unknown }).quaeroRpc === "function",
    );
    expect(hasBridge, "the frontend must see a bridge").toBe(true);
  });

  test("the page's own calls reach the core", async ({ app }) => {
    await app.open();
    // Call through the frontend's global exactly as the app does, with the
    // frontend's own numeric id, and check it comes back correlated.
    const answered = await app.page.evaluate(async () => {
      const rpc = (globalThis as { quaeroRpc?: (raw: string) => Promise<unknown> })
        .quaeroRpc;
      if (rpc === undefined) {
        return null;
      }
      const res = (await rpc(
        JSON.stringify({ jsonrpc: "2.0", id: 4242, method: "app.hello" }),
      )) as { id?: number | string };
      return res.id ?? null;
    });
    expect(answered, "the response must carry the id the page sent").toBe(4242);
  });

  test("browser state starts from a known point", async ({ app }) => {
    await app.open();
    const state = await app.page.evaluate(() => ({
      locale: localStorage.getItem("quaero.locale"),
      history: localStorage.getItem("quaero.history"),
      connections: localStorage.getItem("quaero.connections"),
    }));
    expect(state.locale, "locale is pinned, not autodetected").toBe("es");
    expect(state.history, "no history inherited from a previous run").toBeNull();
    expect(state.connections, "the engine's connection was seeded").not.toBeNull();
  });

  test("the fixture is there and is the same every run", async ({ app }) => {
    // Through the core, not the UI: this asserts the seeding contract itself.
    const connId = await (async () => {
      const res = await app.rpc.call("conn.open", {
        driver: app.engine.driver,
        dsn: app.engine.dsn,
      });
      return (res.result as { connId: string }).connId;
    })();

    const res = await app.rpc.call("query.run", {
      connId,
      sql: "SELECT id, nombre FROM e2e_items ORDER BY id",
      limit: 100,
    });
    await app.rpc.call("conn.close", { connId });

    expect(res.error).toBeUndefined();
    const rows = (res.result as { rows: string[][] }).rows;
    expect(rows.length, "three special rows plus the filler").toBeGreaterThan(3);
    expect(rows[0]?.[1]).toBe("Nogales");
    expect(rows[1]?.[1], "the discriminating value").toBe(
      app.engine.encodingRows.discriminator,
    );
    expect(rows[2]?.[1], "the accented value").toBe(
      app.engine.encodingRows.accented,
    );
  });
});
