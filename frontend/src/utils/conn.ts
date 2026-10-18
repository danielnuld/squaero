// Active-connection lifecycle over IPC: open, close and a connectivity test.
// The response parser is pure and unit-tested; the wrappers pair it with the
// transport. Contract: docs/IPC.md (conn.open / conn.close).

import { call, setConnGuard } from "./transport";
import { buildDsn, type Connection } from "./connections";
import { guardFor } from "./safeMode";
import { isError, type JsonRpcResponse } from "./ipc";
import { QueryError } from "./query";
import { schemaTree, parseTreeRows } from "./schema";

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

/** What the engine behind a connection can do: conn.open's `features` (#668). */
export interface ConnFeatures {
  cancel: boolean;
  transactions: boolean;
  ddl: boolean;
  dml: boolean;
  schemas: boolean;
  introspection: boolean;
}

/**
 * The features a conn.open response reports, or null when it reports none (a
 * core older than #668): then nothing is known and the UI keeps its old
 * behaviour. A key that is not a boolean reads as false — the core always sends
 * all of them, so that is a malformed answer, not a capability.
 */
export function parseConnFeatures(res: JsonRpcResponse): ConnFeatures | null {
  if (isError(res)) return null;
  const f = (res.result as { features?: unknown } | undefined)?.features;
  if (typeof f !== "object" || f === null) return null;
  const on = (k: string) => (f as Record<string, unknown>)[k] === true;
  return {
    cancel: on("cancel"),
    transactions: on("transactions"),
    ddl: on("ddl"),
    dml: on("dml"),
    schemas: on("schemas"),
    introspection: on("introspection"),
  };
}

/** Opens a connection and resolves with its connId and the engine's features. */
export async function openSession(
  driver: string,
  dsn: Record<string, string>,
): Promise<{ connId: string; features: ConnFeatures | null }> {
  const res = await call("conn.open", { driver, dsn });
  return { connId: parseConnId(res), features: parseConnFeatures(res) };
}

/** Opens a connection through a registered driver and resolves with its connId. */
export async function openConnection(
  driver: string,
  dsn: Record<string, string>,
): Promise<string> {
  return (await openSession(driver, dsn)).connId;
}

/**
 * Opens a SAVED connection, carrying its safe mode (issue #666) onto the new
 * session: every later call on it goes through the transport guard. Use this,
 * not openConnection, for anything the user picked from their connections.
 */
export async function openSaved(c: Connection): Promise<string> {
  const connId = await openConnection(c.driver, buildDsn(c));
  setConnGuard(connId, guardFor(c));
  return connId;
}

/** Closes an active connection. Resolves even if the core reports it was absent. */
export async function closeConnection(connId: string): Promise<void> {
  setConnGuard(connId, null);
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

/**
 * Opens a temporary connection, lists the server's databases (schema.tree at the
 * root, i.e. the driver's list_databases), then closes it — so the connection
 * form can offer the main database as a dropdown once the details are filled in.
 * Always closes the probe connection, even on error.
 */
export async function listDatabases(
  driver: string,
  dsn: Record<string, string>,
): Promise<string[]> {
  const connId = await openConnection(driver, dsn);
  try {
    const rows = parseTreeRows(await schemaTree(connId), "database");
    return rows.map((r) => r.name);
  } finally {
    await closeConnection(connId);
  }
}
