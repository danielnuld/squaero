// Transport over the webview bridge. The native shell binds a global function
// `quaeroRpc(requestJson) -> Promise<responseJson>` (see app/src/main.cc).
// In a plain browser (e.g. `pnpm dev`) the bridge is absent; callers should
// check hasBridge() or handle the thrown error.

import {
  buildRequest,
  connIdOfParams,
  IPC_ERR_CONN,
  isError,
  nextId,
  parseResponse,
  type JsonRpcResponse,
} from "./ipc";
import { lostInfo, mayRetry, notRetried, type ConnActivity } from "./reconnect";

// webview already JSON-parses the value passed to webview_return, so the bound
// function resolves with a parsed object (not a string). Typed as unknown to
// stay honest about that.
export type QuaeroRpc = (requestJson: string) => Promise<unknown>;

/** Exported so tests bind the bridge through the same shape the app reads. A
    private copy in the test drifted to `Promise<string>`, which contradicted the
    comment right above and every mock the test itself writes. */
export interface BridgeHost {
  quaeroRpc?: QuaeroRpc;
}

/** True when running inside the native shell (the bridge is available). */
export function hasBridge(): boolean {
  return typeof (globalThis as BridgeHost).quaeroRpc === "function";
}

/**
 * Notified when a call fails because the connection it ran on is gone (issue
 * #407). Registered once by the app; there is no reason for two listeners, and a
 * list would only make it unclear who owns the reaction.
 *
 * `data` is the core's error data (lostInfo, #676). The listener may reconnect
 * and say so: `reconnectedTo` is the new session, `txLost` that a transaction
 * died with the old one. call() then re-sends the failed call once on the new
 * session when the core proved that safe, and otherwise marks the error with
 * why it was not retried (`data.notRetried`).
 */
export interface LostOutcome {
  reconnectedTo: string | null;
  txLost: boolean;
}
export type ConnectionLostListener = (
  connId: string,
  data?: unknown,
) => void | LostOutcome | Promise<LostOutcome | void>;

let lostListener: ConnectionLostListener | null = null;

/** Register (or clear, with null) the connection-lost listener. */
export function onConnectionLost(fn: ConnectionLostListener | null): void {
  lostListener = fn;
}

/**
 * Did this response say the connection died?
 *
 * -32000 is "could not open OR use the connection", and which one it is depends
 * on the method: `conn.open` is the only one that opens, so from every other
 * method the connection was already open and has stopped working. That is why
 * this needs no new protocol code — the caller already knows what it asked for.
 */
function saysConnectionLost(method: string, res: JsonRpcResponse): boolean {
  return method !== "conn.open" && isError(res) && res.error.code === IPC_ERR_CONN;
}

/**
 * Sends a JSON-RPC call to the core and resolves with the parsed response.
 *
 * The connection-lost check lives HERE rather than in each caller's catch: every
 * method goes through this function, so a query, a commit, a row update and a
 * catalog read all report a dead connection the same way, and none of them can
 * forget to (issue #407).
 *
 * `retried` is internal: set on the one re-send after a reconnect (#676).
 */
export async function call(
  method: string,
  params?: unknown,
  retried = false,
): Promise<JsonRpcResponse> {
  const rpc = (globalThis as BridgeHost).quaeroRpc;
  if (typeof rpc !== "function") {
    throw new Error(
      "Squaero bridge unavailable (not running inside the webview shell)",
    );
  }
  const connId = connIdOfParams(params);
  const act = connId !== null ? activityOf(connId) : null;
  if (act) {
    act.inFlight += 1;
    act.last = Date.now();
  }
  const request = buildRequest(nextId(), method, params);
  let result: unknown;
  try {
    result = await rpc(JSON.stringify(request));
  } finally {
    if (act) {
      act.inFlight -= 1;
      act.last = Date.now();
    }
  }
  if (connId !== null && method === "conn.close") activity.delete(connId);
  // The webview bridge resolves with an already-parsed object; only parse if a
  // transport hands back a raw JSON string.
  const res =
    typeof result === "string" ? parseResponse(result) : (result as JsonRpcResponse);

  if (connId !== null && saysConnectionLost(method, res) && isError(res)) {
    const data = res.error.data;
    const out = (await lostListener?.(connId, data)) || null;
    const to = out?.reconnectedTo ?? null;
    // Once, and only what the core proved safe: a read outside a transaction
    // (issue #676). The retry goes to the new session the listener opened.
    if (to !== null && mayRetry(lostInfo(data), true, retried)) {
      return call(method, { ...(params as object), connId: to }, true);
    }
    res.error.data = {
      ...(typeof data === "object" && data !== null ? data : {}),
      notRetried: notRetried(out?.txLost ?? false, to !== null),
    };
  }
  return res;
}

// Per-connection traffic, for keep-alive (#676): a probe only goes out on a
// connection that is idle. Dropped when the connection is closed.
const activity = new Map<string, ConnActivity>();

function activityOf(connId: string): ConnActivity {
  let a = activity.get(connId);
  if (!a) {
    a = { inFlight: 0, last: 0 };
    activity.set(connId, a);
  }
  return a;
}

/** The connection's traffic so far; a connection never used reads as idle
    since forever. */
export function connActivity(connId: string): ConnActivity {
  return { ...(activity.get(connId) ?? { inFlight: 0, last: 0 }) };
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
