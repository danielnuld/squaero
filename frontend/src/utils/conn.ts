// Active-connection lifecycle over IPC: open, close and a connectivity test.
// The response parser is pure and unit-tested; the wrappers pair it with the
// transport. Contract: docs/IPC.md (conn.open / conn.close).

import { call } from "./transport";
import { isError, type JsonRpcResponse } from "./ipc";
import { QueryError } from "./query";

/** Extracts the connId from a conn.open response, or throws QueryError. */
export function parseConnId(res: JsonRpcResponse): string {
  if (isError(res)) {
    throw new QueryError(res.error.message, res.error.code, res.error.data);
  }
  const result = (res.result ?? {}) as { connId?: unknown };
  if (typeof result.connId !== "string") {
    throw new QueryError("La respuesta de conn.open no incluyó connId.", -32603);
  }
  return result.connId;
}

/** Opens a connection through a registered driver and resolves with its connId. */
export async function openConnection(
  driver: string,
  dsn: Record<string, string>,
): Promise<string> {
  const res = await call("conn.open", { driver, dsn });
  return parseConnId(res);
}

/** Closes an active connection. Resolves even if the core reports it was absent. */
export async function closeConnection(connId: string): Promise<void> {
  await call("conn.close", { connId });
}

/**
 * Tests connectivity by opening and immediately closing a connection. Resolves
 * on success; rejects with the driver's error otherwise. Never leaves the test
 * connection open.
 */
export async function testConnection(
  driver: string,
  dsn: Record<string, string>,
): Promise<void> {
  const connId = await openConnection(driver, dsn);
  await closeConnection(connId);
}
