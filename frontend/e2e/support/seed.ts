// Fixture seeding, and the availability probe that decides what runs.
//
// Seeding goes through the core rather than through the interface on purpose: it is
// fast, and it does not depend on the very interface under test working. A suite
// that cannot set itself up when the UI is broken cannot tell you the UI is broken.

import {
  ENGINES,
  engineByName,
  type EngineName,
  type EngineSpec,
} from "./engines";
import { startRpc, unwrap, type RpcClient } from "./rpc";
import type { Availability } from "./availability";

interface ConnOpen {
  connId: string;
}

/** Opens a connection for `engine`, or throws with the engine's own reason. */
export async function openConn(rpc: RpcClient, engine: EngineSpec): Promise<string> {
  const res = await rpc.call("conn.open", {
    driver: engine.driver,
    dsn: engine.dsn,
  });
  const result = unwrap(res, `conn.open(${engine.name})`) as ConnOpen;
  return result.connId;
}

/** Runs `sql`, throwing on failure unless `tolerate` says otherwise. */
async function run(
  rpc: RpcClient,
  connId: string,
  sql: string,
  tolerate = false,
): Promise<void> {
  const res = await rpc.call("query.run", { connId, sql });
  if (res.error !== undefined && !tolerate) {
    throw new Error(`seed failed on "${sql}": ${res.error.message}`);
  }
}

/**
 * Rebuilds `engine`'s fixture from scratch, so two runs in a row start identically
 * however much the previous one inserted, updated or deleted.
 */
export async function reseed(rpc: RpcClient, name: EngineName): Promise<void> {
  const engine = engineByName(name);
  const connId = await openConn(rpc, engine);
  try {
    // A missing table is the normal case on a first run, so this one may fail.
    await run(rpc, connId, engine.dropFixture, true);
    for (const sql of engine.fixture) {
      await run(rpc, connId, sql);
    }
  } finally {
    await rpc.call("conn.close", { connId });
  }
}

/**
 * Adds the bulk rows on top of the base fixture, for the paging case only.
 *
 * Kept out of the base fixture on purpose: reseeding runs before every test, and
 * making every one of them insert a thousand rows would tax the whole suite for the
 * benefit of a single case.
 */
export async function bulkFill(rpc: RpcClient, name: EngineName): Promise<void> {
  const engine = engineByName(name);
  const connId = await openConn(rpc, engine);
  try {
    for (const sql of engine.bulk) {
      await run(rpc, connId, sql);
    }
  } finally {
    await rpc.call("conn.close", { connId });
  }
}

/**
 * Probes every engine once: did its driver load, and does its database answer?
 * Runs in globalSetup, before any browser exists.
 */
export async function probeEngines(): Promise<Availability[]> {
  const rpc = await startRpc();
  const loaded = rpc.loadedDrivers();
  const out: Availability[] = [];

  try {
    for (const engine of ENGINES) {
      try {
        if (!loaded.includes(engine.driver)) {
          out.push({
            name: engine.name,
            available: false,
            reason:
              `driver plugin '${engine.driver}' did not load ` +
              `(loaded: ${loaded.join(", ") || "none"})`,
          });
          continue;
        }
        const connId = await openConn(rpc, engine);
        await rpc.call("conn.close", { connId });
        // Seed here too, so the very first test file finds a fixture even if it
        // forgets to ask for one.
        await reseed(rpc, engine.name);
        out.push({ name: engine.name, available: true, reason: "" });
      } catch (err) {
        out.push({
          name: engine.name,
          available: false,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rpc.close();
  }

  return out;
}
