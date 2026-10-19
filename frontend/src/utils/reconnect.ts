// Automatic reconnection and keep-alive (issue #676). Pure policy; the transport
// and App.tsx carry it out.
//
// The core keeps no DSN, so it cannot reconnect: it reports a dead session as a
// -32000 whose `data` says whether a transaction was open and whether re-sending
// the call is safe (docs/IPC.md, "Conexión perdida"). The frontend holds the
// saved connection, so it opens a fresh session and, only when the core proved
// it safe, re-sends the failed call once on it.

import { engineFamily } from "./engineFamily";

/** What the core said about a dead session (error.data of a -32000). */
export interface LostInfo {
  /** A transaction was open: the server rolled it back with the session. */
  inTx: boolean;
  /** Re-sending the call cannot repeat a change (a read outside a transaction). */
  retrySafe: boolean;
}

/** Reads the core's lost-connection data; null when there is none (an older
    core), which is treated as the least safe case. */
export function lostInfo(data: unknown): LostInfo | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { connLost?: unknown; inTx?: unknown; retrySafe?: unknown };
  if (d.connLost !== true) return null;
  return { inTx: d.inTx === true, retrySafe: d.retrySafe === true };
}

/**
 * Reconnect without asking? Only when no transaction dies unnoticed: neither the
 * one the core tracks nor one only the editor knows of (a BEGIN with options runs
 * as typed and never reaches tx.begin). An older core that says nothing keeps the
 * #407 behaviour: the connection is marked lost and the user reconnects.
 */
export function mayReconnect(info: LostInfo | null, uiTxOpen: boolean): boolean {
  return info !== null && !info.inTx && !uiTxOpen;
}

/** Re-send the failed call on the new session? Once, and only what the core
    proved safe. */
export function mayRetry(info: LostInfo | null, reconnected: boolean, retried: boolean): boolean {
  return reconnected && !retried && info?.retrySafe === true;
}

/** Why a call that met a dead session was not retried — the explicit error:
    - "tx": a transaction was open; the server rolled it back.
    - "unsafe": reconnected, but the statement may or may not have run.
    - "down": not reconnected (failed, or not allowed); it may or may not have run. */
export type NotRetried = "tx" | "unsafe" | "down";

export function notRetried(txLost: boolean, reconnected: boolean): NotRetried {
  if (txLost) return "tx";
  return reconnected ? "unsafe" : "down";
}

/** The i18n key of each reason (messages/{en,es}.ts). */
export const NOT_RETRIED_KEY: Record<NotRetried, string> = {
  tx: "conn.lostTx",
  unsafe: "conn.lostNotRetried",
  down: "conn.lostDown",
};

/**
 * The cheapest statement that proves a session is alive, or null when keep-alive
 * does not apply: SQLite is a local file that cannot drop, and MongoDB's client
 * already monitors and reconnects by itself (its query channel has no ping).
 */
export function keepAliveProbe(driver: string): string | null {
  switch (engineFamily(driver)) {
    case "mysql":
    case "postgres":
    case "mssql":
      return "SELECT 1";
    case "informix":
      return "SELECT 1 FROM systables WHERE tabid = 1";
    default:
      return null;
  }
}

/** Longest wait between probes once they keep failing. */
const MAX_BACKOFF_SEC = 600;

/** Seconds until the next probe: the interval, doubled per consecutive failure
    up to 10 minutes (never shorter than the interval itself). */
export function keepAliveDelaySec(intervalSec: number, failures: number): number {
  const backoff = intervalSec * 2 ** Math.min(Math.max(failures, 0), 10);
  return Math.min(backoff, Math.max(intervalSec, MAX_BACKOFF_SEC));
}

/** A connection's traffic, as the transport sees it. */
export interface ConnActivity {
  /** Calls on it still waiting for an answer. */
  inFlight: number;
  /** When the last call on it started or finished (ms). */
  last: number;
}

/**
 * Probe now? Keep-alive on (interval > 0), the connection idle (nothing in
 * flight — a probe never queues behind the user's query), and quiet for the
 * interval (any call counts as traffic, so a busy connection is never probed).
 */
export function keepAliveDue(
  now: number,
  intervalSec: number,
  activity: ConnActivity,
  failures: number,
): boolean {
  if (!(intervalSec > 0) || activity.inFlight > 0) return false;
  return now - activity.last >= keepAliveDelaySec(intervalSec, failures) * 1000;
}

/** A saved keep-alive value: whole seconds > 0, anything else is off. */
export function normalizeKeepAlive(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

/** Seconds before the next automatic attempt to reopen a session that could not
    be reopened (server down, network gone): 5, 10, 20, 40, then every 60. Only
    for a session lost with no transaction — one that died with a transaction
    waits for the user, who has to know it was rolled back. */
export function retryDelaySec(attempt: number): number {
  return Math.min(60, 5 * 2 ** Math.max(0, Math.min(attempt, 4)));
}

/** Whole seconds left until `at` (ms), never below 0: the band's countdown. */
export function secondsLeft(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / 1000));
}
