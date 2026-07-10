// Transport over the webview bridge. The native shell binds a global function
// `quaeroRpc(requestJson) -> Promise<responseJson>` (see app/src/main.cc).
// In a plain browser (e.g. `pnpm dev`) the bridge is absent; callers should
// check hasBridge() or handle the thrown error.

import {
  buildRequest,
  isError,
  nextId,
  parseResponse,
  type JsonRpcResponse,
} from "./ipc";

// webview already JSON-parses the value passed to webview_return, so the bound
// function resolves with a parsed object (not a string). Typed as unknown to
// stay honest about that.
type QuaeroRpc = (requestJson: string) => Promise<unknown>;

interface BridgeHost {
  quaeroRpc?: QuaeroRpc;
}

/** True when running inside the native shell (the bridge is available). */
export function hasBridge(): boolean {
  return typeof (globalThis as BridgeHost).quaeroRpc === "function";
}

/** Sends a JSON-RPC call to the core and resolves with the parsed response. */
export async function call(
  method: string,
  params?: unknown,
): Promise<JsonRpcResponse> {
  const rpc = (globalThis as BridgeHost).quaeroRpc;
  if (typeof rpc !== "function") {
    throw new Error(
      "Quaero bridge unavailable (not running inside the webview shell)",
    );
  }
  const request = buildRequest(nextId(), method, params);
  const result = await rpc(JSON.stringify(request));
  // The webview bridge resolves with an already-parsed object; only parse if a
  // transport hands back a raw JSON string.
  return typeof result === "string"
    ? parseResponse(result)
    : (result as JsonRpcResponse);
}

/**
 * Requests cancellation of the query currently running on `connId` (op.cancel).
 * Resolves with true only when the core actually delivered a cancel to the
 * driver; a query that already finished, or an engine that cannot cancel, both
 * resolve false (neither is an error). Safe to call when nothing is running.
 * This travels on a channel the core dispatches WITHOUT queueing behind the
 * running query, so it reaches the driver while the query is still in flight.
 */
export async function cancelQuery(connId: string): Promise<boolean> {
  const res = await call("op.cancel", { connId });
  if (isError(res)) {
    return false;
  }
  return Boolean((res.result as { canceled?: boolean } | undefined)?.canceled);
}
