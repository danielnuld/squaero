// Installs the bridge the frontend expects, backed by the real core.
//
// src/utils/transport.ts calls exactly one global:
//
//     globalThis.quaeroRpc(requestJson) -> Promise<response>
//
// The native shell binds it to the webview host; here it forwards to a live
// quaero-rpc process. Nothing in production changes: hasBridge() already tolerates
// the global being absent, which is what `pnpm dev` relies on.

import type { Page } from "@playwright/test";
import type { RpcClient } from "./rpc";

/** Name of the Node function exposed into the page. Prefixed to avoid clashes. */
const EXPOSED = "__quaeroE2eBridge";

/**
 * Installs the bridge and returns a teardown that closes whatever the page left
 * open.
 *
 * Tracking connections is not bookkeeping for its own sake: a test that ends with
 * an edit transaction still open leaves locks behind, and the next test's reseed
 * then fails to DROP the fixture table. On Informix that turned the rollback case
 * into an order-dependent failure — it passed alone and failed after the commit
 * case. Isolation has to be the harness's job, not each test's.
 */
export async function installBridge(page: Page, rpc: RpcClient): Promise<() => Promise<void>> {
  const open = new Set<string>();

  await page.exposeFunction(EXPOSED, async (requestJson: string) => {
    const response = await rpc.forward(requestJson);

    // Watch the conversation for connections coming and going.
    try {
      const req = JSON.parse(requestJson) as { method?: string; params?: { connId?: string } };
      if (req.method === "conn.open") {
        const id = (response.result as { connId?: string } | undefined)?.connId;
        if (id !== undefined) {
          open.add(id);
        }
      } else if (req.method === "conn.close" && req.params?.connId !== undefined) {
        open.delete(req.params.connId);
      }
    } catch {
      // A request we cannot parse is the core's problem to report, not ours.
    }

    // Returning the parsed object mirrors the native shell, whose webview_return
    // already JSON-parses the value. transport.ts accepts either shape, and this
    // stays on the shape the real thing uses.
    return response;
  });

  await page.addInitScript(
    ({ exposed }) => {
      const host = globalThis as unknown as Record<string, unknown>;
      host.quaeroRpc = (requestJson: string): Promise<unknown> => {
        const fn = host[exposed] as (raw: string) => Promise<unknown>;
        return fn(requestJson);
      };
    },
    { exposed: EXPOSED },
  );

  return async () => {
    for (const connId of open) {
      // Rolling back first releases any locks an abandoned edit transaction holds.
      await rpc.call("tx.rollback", { connId }).catch(() => undefined);
      await rpc.call("conn.close", { connId }).catch(() => undefined);
    }
    open.clear();
  };
}
