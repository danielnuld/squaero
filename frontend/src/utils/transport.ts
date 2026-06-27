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

type QuaeroRpc = (requestJson: string) => Promise<string>;

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
  const raw = await rpc(JSON.stringify(request));
  return parseResponse(raw);
}
