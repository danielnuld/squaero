#!/usr/bin/env node
// Reproducible smoke test for a Quaero engine (issue #199). Drives the REAL core
// + driver through the quaero-rpc stdio bridge — no webview — and reports ✅/❌
// per step of the critical path:
//   conectar → árbol → describe → SELECT paginado → insert/update/delete
//   transaccional → export CSV → desconectar
//
// Usage:
//   node smoke.mjs <engine> [driversDir]
//     engine      sqlite | mysql | mongodb
//     driversDir  dir with driver plugins (default: build/app/drivers)
//
// DSN via env (JSON), else a sensible default:
//   QUAERO_SMOKE_DSN   e.g. '{"host":"127.0.0.1","port":"13306",...}'
//   QUAERO_RPC         path to quaero-rpc[.exe] (default: build/tools/quaero-rpc[.exe])
//
// Exit code 0 = all steps passed, 1 = a step failed, 2 = harness error.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { platform } from "node:process";

const engine = process.argv[2];
const driversDir = process.argv[3] ?? "build/app/drivers";
if (!engine) {
  console.error("usage: node smoke.mjs <sqlite|mysql|mongodb> [driversDir]");
  process.exit(2);
}

const exe =
  process.env.QUAERO_RPC ??
  (platform === "win32" ? "build/tools/quaero-rpc.exe" : "build/tools/quaero-rpc");
if (!existsSync(exe)) {
  console.error(`quaero-rpc not found at ${exe} (build the quaero-rpc target first)`);
  process.exit(2);
}

const DEFAULT_DSN = {
  sqlite: { path: ":memory:" },
  mysql: { host: "127.0.0.1", port: "13306", user: "root", password: "test123", database: "testdb" },
  mongodb: { host: "127.0.0.1", port: "27017", database: "test" },
};
const dsn = process.env.QUAERO_SMOKE_DSN ? JSON.parse(process.env.QUAERO_SMOKE_DSN) : DEFAULT_DSN[engine];
const driver = engine;

// Per-engine column DDL for the throwaway smoke table.
const CREATE_COLS = {
  sqlite: "id INTEGER, name TEXT",
  mysql: "id INT, name VARCHAR(50)",
  informix: "id INT, name VARCHAR(50)",
};
const TABLE = "quaero_smoke";

// --- rpc plumbing ---------------------------------------------------------
const child = spawn(exe, [driversDir], { stdio: ["pipe", "pipe", "inherit"] });
const rl = createInterface({ input: child.stdout });
const lines = [];
let waiter = null;
rl.on("line", (l) => {
  if (waiter) { const w = waiter; waiter = null; w(l); }
  else lines.push(l);
});
const nextLine = () =>
  new Promise((resolve) => {
    if (lines.length) resolve(lines.shift());
    else waiter = resolve;
  });

let id = 0;
async function rpc(method, params) {
  id += 1;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  const line = await nextLine();
  const msg = JSON.parse(line);
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
  return msg.result;
}

function toCsv(result) {
  const cols = result.columns.map((c) => c.name ?? c);
  const rows = result.rows.map((r) => r.map((v) => (v === null ? "" : String(v))).join(","));
  return [cols.join(","), ...rows].join("\r\n");
}

// --- steps ----------------------------------------------------------------
let connId = null;
let pass = 0, fail = 0;
async function step(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`  ❌ ${name} — ${e.message}`);
  }
}

async function sqlSmoke() {
  const cols = CREATE_COLS[engine] ?? CREATE_COLS.mysql;
  await step("conectar", async () => {
    const r = await rpc("conn.open", { driver, dsn });
    connId = r.connId;
    if (!connId) throw new Error("no connId");
  });
  await step("crear tabla (DDL)", async () => {
    await rpc("query.run", { connId, sql: `DROP TABLE IF EXISTS ${TABLE}` }).catch(() => {});
    await rpc("query.run", { connId, sql: `CREATE TABLE ${TABLE} (${cols})` });
  });
  await step("insertar filas (DML)", async () => {
    const r = await rpc("query.run", { connId, sql: `INSERT INTO ${TABLE} VALUES (1,'a'),(2,'b'),(3,'c')` });
    if (r.rowsAffected !== 3) throw new Error(`rowsAffected=${r.rowsAffected}`);
  });
  await step("SELECT paginado (página 1)", async () => {
    const r = await rpc("query.run", { connId, sql: `SELECT id,name FROM ${TABLE} ORDER BY id`, limit: 2 });
    if (r.rows.length !== 2) throw new Error(`rows=${r.rows.length}`);
    if (!r.truncated) throw new Error("truncated should be true");
  });
  await step("SELECT paginado (página 2, offset)", async () => {
    const r = await rpc("query.run", { connId, sql: `SELECT id,name FROM ${TABLE} ORDER BY id`, limit: 2, offset: 2 });
    if (r.rows.length !== 1) throw new Error(`rows=${r.rows.length}`);
  });
  await step("árbol de objetos", async () => {
    const r = await rpc("schema.tree", { connId });
    if (!r || !r.rows) throw new Error("no tree");
  });
  await step("describe tabla", async () => {
    const r = await rpc("schema.describe", { connId, table: TABLE });
    if (!r.rows || r.rows.length < 1) throw new Error("no columns");
  });
  await step("edición transaccional (begin/insert/update/delete/commit)", async () => {
    await rpc("tx.begin", { connId });
    const ins = await rpc("row.insert", { connId, table: TABLE, values: { id: "99", name: "z" } });
    if (ins.rowsAffected !== 1) throw new Error(`insert rowsAffected=${ins.rowsAffected}`);
    const upd = await rpc("row.update", { connId, table: TABLE, set: { name: "zz" }, where: { id: "99" } });
    if (upd.rowsAffected !== 1) throw new Error(`update rowsAffected=${upd.rowsAffected}`);
    const del = await rpc("row.delete", { connId, table: TABLE, where: { id: "99" } });
    if (del.rowsAffected !== 1) throw new Error(`delete rowsAffected=${del.rowsAffected}`);
    await rpc("tx.commit", { connId });
  });
  await step("rollback deshace cambios", async () => {
    await rpc("tx.begin", { connId });
    await rpc("row.insert", { connId, table: TABLE, values: { id: "77", name: "x" } });
    await rpc("tx.rollback", { connId });
    const r = await rpc("query.run", { connId, sql: `SELECT COUNT(*) FROM ${TABLE}` });
    if (r.rows[0][0] !== "3") throw new Error(`count after rollback=${r.rows[0][0]}`);
  });
  await step("export CSV (pipeline)", async () => {
    const r = await rpc("query.run", { connId, sql: `SELECT id,name FROM ${TABLE} ORDER BY id` });
    const csv = toCsv(r);
    if (csv.split("\r\n").length !== 4) throw new Error("expected header + 3 rows");
  });
  await step("limpiar", async () => {
    await rpc("query.run", { connId, sql: `DROP TABLE ${TABLE}` });
  });
  await step("desconectar", async () => {
    await rpc("conn.close", { connId });
  });
}

async function mongoSmoke() {
  // Read-only path: MongoDB is find/aggregate only in Quaero.
  await step("conectar", async () => {
    const r = await rpc("conn.open", { driver, dsn });
    connId = r.connId;
    if (!connId) throw new Error("no connId");
  });
  await step("árbol (colecciones)", async () => {
    const r = await rpc("schema.tree", { connId });
    if (!r) throw new Error("no tree");
  });
  await step("SELECT paginado (find + limit)", async () => {
    await rpc("query.run", { connId, sql: "db.quaero_smoke.find({}).limit(2)", limit: 2 });
  });
  await step("desconectar", async () => {
    await rpc("conn.close", { connId });
  });
}

(async () => {
  console.log(`\nSmoke: ${engine} (drivers: ${driversDir})`);
  try {
    if (engine === "mongodb") await mongoSmoke();
    else await sqlSmoke();
  } catch (e) {
    console.error("harness error:", e.message);
  } finally {
    child.stdin.end();
  }
  console.log(`\n${fail === 0 ? "✅ OK" : "❌ FAIL"}: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
