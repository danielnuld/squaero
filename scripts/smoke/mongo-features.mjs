#!/usr/bin/env node
// Feature-level verification for MongoDB (issue #198), beyond the core-path
// smoke (#199). MongoDB is read-only in Quaero (find/aggregate), so this checks
// the read surface + honest rendering: collection tree, describe (field
// inference by sampling), find + pagination, aggregate, and legible rendering
// of special BSON types (ObjectId, ISODate, nested docs, arrays, Decimal128,
// plus unicode/emoji). SQL-centric tools (users/monitor/procedures/triggers/
// ER/builder) are honest ➖ in the UI and need no server.
//
// Seed first (a mongo:7 container on :27017):
//   docker exec <c> mongosh --quiet --eval '<seed of db quaero_qa: docs, big>'
//
// Usage:  node mongo-features.mjs [driversDir]
//   driversDir  dir with the mongodb plugin (default: build/app/drivers)
//   QUAERO_RPC        quaero-rpc[.exe] (default: build/tools/quaero-rpc[.exe])
//   QUAERO_SMOKE_DSN  JSON DSN (default: 127.0.0.1:27017 db quaero_qa)
//
// Exit code 0 = all checks passed, 1 = a check failed, 2 = harness error.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { platform } from "node:process";

const driversDir = process.argv[2] ?? "build/app/drivers";
const exe =
  process.env.QUAERO_RPC ??
  (platform === "win32" ? "build/tools/quaero-rpc.exe" : "build/tools/quaero-rpc");
if (!existsSync(exe)) { console.error(`quaero-rpc not found at ${exe}`); process.exit(2); }
const dsn = process.env.QUAERO_SMOKE_DSN
  ? JSON.parse(process.env.QUAERO_SMOKE_DSN)
  : { host: "127.0.0.1", port: "27017", database: "quaero_qa" };

const child = spawn(exe, [driversDir], { stdio: ["pipe", "pipe", "inherit"] });
const rl = createInterface({ input: child.stdout });
const lines = []; let waiter = null;
rl.on("line", (l) => { if (waiter) { const w = waiter; waiter = null; w(l); } else lines.push(l); });
const nextLine = () => new Promise((r) => { if (lines.length) r(lines.shift()); else waiter = r; });
let id = 0;
async function rpc(method, params) {
  id++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  const m = JSON.parse(await nextLine());
  if (m.error) throw new Error(m.error.message);
  return m.result;
}
let pass = 0, fail = 0;
async function step(name, fn) {
  try { const info = await fn(); pass++; console.log(`  ✅ ${name}${info ? " — " + info : ""}`); }
  catch (e) { fail++; console.log(`  ❌ ${name} — ${e.message}`); }
}

(async () => {
  let connId;
  await step("conectar", async () => {
    connId = (await rpc("conn.open", { driver: "mongodb", dsn })).connId;
    if (!connId) throw new Error("no connId");
  });

  await step("árbol de colecciones", async () => {
    const r = await rpc("schema.tree", { connId, db: "quaero_qa" });
    const names = r.rows.map((x) => x[0]);
    if (!names.includes("docs") || !names.includes("big")) throw new Error("faltan colecciones: " + names);
    return names.join(",");
  });

  await step("describe: inferencia de campos (muestreo)", async () => {
    const d = await rpc("schema.describe", { connId, db: "quaero_qa", table: "docs" });
    const cols = d.rows.map((x) => x[0]);
    for (const c of ["_id", "nombre", "edad", "creado", "saldo", "direccion", "tags"]) {
      if (!cols.includes(c)) throw new Error(`campo ${c} no inferido (${cols})`);
    }
    return cols.length + " campos";
  });

  await step("find + tipos BSON especiales legibles (ObjectId/ISODate/Decimal/nested/array/emoji)", async () => {
    const r = await rpc("query.run", { connId, sql: "db.docs.find({}).sort({edad:1})" });
    const flat = JSON.stringify(r.rows);
    // ObjectId rendered as a 24-hex string
    if (!/[0-9a-f]{24}/.test(flat)) throw new Error("ObjectId no legible");
    // ISODate rendered as an ISO string
    if (!/2020-01-15/.test(flat)) throw new Error("ISODate no legible");
    // Decimal128
    if (!/1234\.56/.test(flat)) throw new Error("Decimal128 no legible");
    // nested doc + array rendered as JSON text
    if (!/Hermosillo/.test(flat) || !/\[/.test(flat)) throw new Error("doc anidado/array no legible");
    // emoji round-trips
    if (!/😀/.test(flat)) throw new Error("emoji no legible");
    return "ObjectId/ISODate/Decimal/nested/array/emoji ok";
  });

  await step("aggregate ($match)", async () => {
    const r = await rpc("query.run", { connId, sql: "db.docs.aggregate([{$match: {activo: true}}])" });
    if (r.rows.length !== 1) throw new Error("esperaba 1 doc activo, got " + r.rows.length);
    return "1 doc activo";
  });

  await step("paginación (skip + limit)", async () => {
    const p1 = await rpc("query.run", { connId, sql: "db.big.find({}).sort({n:1}).limit(5)" });
    const p2 = await rpc("query.run", { connId, sql: "db.big.find({}).sort({n:1}).skip(5).limit(5)" });
    if (p1.rows.length !== 5 || p2.rows.length !== 5) throw new Error("tamaños de página incorrectos");
    if (JSON.stringify(p1.rows) === JSON.stringify(p2.rows)) throw new Error("skip no avanzó");
    return "p1≠p2, 5+5";
  });

  await step("desconectar", async () => { await rpc("conn.close", { connId }); });

  console.log(`\nMongoDB features: ${pass} passed, ${fail} failed`);
  child.stdin.end(); child.kill();
  process.exit(fail === 0 ? 0 : 1);
})();
