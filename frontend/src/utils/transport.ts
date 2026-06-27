// Transport over the webview bridge. The native shell binds a global function
// `quaeroRpc(requestJson) -> Promise<responseJson>` (see app/src/main.cc).
// In a plain browser (e.g. `pnpm dev`) the bridge is absent; callers should
// check hasBridge() or handle the thrown error.

import {
  buildRequest,
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
