// Pure helpers for the JSON-RPC channel to the C core. The transport (webview
// bind) is wired in issue #3; these helpers are framework-agnostic and tested.
// Contract: docs/IPC.md.

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

let idCounter = 0;

/** Monotonically increasing request id for correlating responses. */
export function nextId(): number {
  idCounter += 1;
  return idCounter;
}

/** Builds a JSON-RPC 2.0 request, omitting `params` when not provided. */
export function buildRequest(
  id: number | string,
  method: string,
  params?: unknown,
): JsonRpcRequest {
  const request: JsonRpcRequest = { jsonrpc: "2.0", id, method };
  if (params !== undefined) {
    request.params = params;
  }
  return request;
}

/** Type guard: true when the response carries an error. */
export function isError(response: JsonRpcResponse): response is JsonRpcError {
  return (response as JsonRpcError).error !== undefined;
}

/** Parses a raw JSON-RPC response string. */
export function parseResponse(raw: string): JsonRpcResponse {
  return JSON.parse(raw) as JsonRpcResponse;
}
