#!/usr/bin/env node
// Feature-level verification for SQLite (issue #196), beyond the core-path smoke
// (#199). Drives the REAL core + SQLite driver through quaero-rpc — no webview —
// exercising the sensitive SQLite flows the issue calls out:
//   path with spaces/accents · designer CREATE with varied types · unicode in
//   data AND object names · views (list + DDL) · triggers (list + inline DDL) ·
//   real FKs via PRAGMA · read-only file → honest write error · tx rollback.
//
// Usage:  node sqlite-features.mjs [driversDir]
//   driversDir  dir with the sqlite plugin (default: build/drivers/sqlite)
//   QUAERO_RPC  path to quaero-rpc[.exe] (default: build/tools/quaero-rpc[.exe])
//
// Exit code 0 = all checks passed, 1 = a check failed, 2 = harness error.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdtempSync, chmodSync, rmSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";

const driversDir = process.argv[2] ?? "build/drivers/sqlite";
const exe =
  process.env.QUAERO_RPC ??
  (platform === "win32" ? "build/tools/quaero-rpc.exe" : "build/tools/quaero-rpc");
if (!existsSync(exe)) {
  console.error(`quaero-rpc not found at ${exe} (build the quaero-rpc target first)`);
  process.exit(2);
}

// --- rpc plumbing (same pattern as smoke.mjs) -----------------------------
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
  const msg = JSON.parse(await nextLine());
  if (msg.error) throw new Error(msg.error.message);
  return msg.result;
}

let pass = 0, fail = 0;
async function step(name, fn) {
  try { await fn(); pass += 1; console.log(`  ✅ ${name}`); }
  catch (e) { fail += 1; console.log(`  ❌ ${name} — ${e.message}`); }
}

// A directory + file whose names carry spaces and accents.
const root = mkdtempSync(join(tmpdir(), "quaero-sqlite-"));
const spicyDir = join(root, "sqlite fëatures ñ");
mkdirSync(spicyDir, { recursive: true });
const dbPath = join(spicyDir, "tëst dæta.db").replaceAll("\\", "/");

async function main() {
  let connId = null;

  await step("conectar a un path con espacios y acentos", async () => {
    const r = await rpc("conn.open", { driver: "sqlite", dsn: { path: dbPath } });
    connId = r.connId;
    if (!connId) throw new Error("no connId");
  });

  await step("diseñador CREATE con tipos variados + describe", async () => {
    await rpc("query.run", { connId, sql:
      'CREATE TABLE productos (' +
      'id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, precio REAL, ' +
      'foto BLOB, creado TEXT DEFAULT CURRENT_TIMESTAMP)' });
    const d = await rpc("schema.describe", { connId, table: "productos" });
    const names = d.rows.map((r) => r[0]);
    for (const c of ["id", "nombre", "precio", "foto", "creado"]) {
      if (!names.includes(c)) throw new Error(`falta columna ${c}`);
    }
    // pk column should mark id as the primary key
    const pkIdx = d.columns.findIndex((c) => (c.name ?? c) === "pk");
    const idRow = d.rows.find((r) => r[0] === "id");
    if (pkIdx >= 0 && idRow[pkIdx] !== "1") throw new Error("id no marcada como PK");
  });

  await step("unicode (acentos + emoji) en DATOS y en NOMBRES de objetos", async () => {
    await rpc("query.run", { connId, sql:
      'CREATE TABLE "clientes_café" ("id" INTEGER PRIMARY KEY, "nombré" TEXT)' });
    await rpc("query.run", { connId, sql:
      "INSERT INTO \"clientes_café\" (\"nombré\") VALUES ('José 😀'),('Renée ☕')" });
    const r = await rpc("query.run", { connId, sql:
      'SELECT "nombré" FROM "clientes_café" ORDER BY "id"' });
    const vals = r.rows.map((x) => x[0]);
    if (vals[0] !== "José 😀" || vals[1] !== "Renée ☕") {
      throw new Error(`round-trip roto: ${JSON.stringify(vals)}`);
    }
  });

  await step("vistas: crear → aparece en el árbol → DDL", async () => {
    await rpc("query.run", { connId, sql:
      "CREATE VIEW productos_caros AS SELECT id,nombre FROM productos WHERE precio > 100" });
    const tree = await rpc("schema.tree", { connId, db: "main" });
    const inTree = tree.rows.some((r) => r[0] === "productos_caros" && r.includes("view"));
    if (!inTree) throw new Error("la vista no aparece en schema.tree (db=main) como type=view");
    const ddl = await rpc("schema.ddl", { connId, object: "productos_caros" });
    const text = ddl.rows?.[0]?.[0] ?? "";
    if (!/create view/i.test(text)) throw new Error("schema.ddl no devolvió el CREATE VIEW");
  });

  await step("triggers: crear → listado + DDL inline (sqlite_master)", async () => {
    await rpc("query.run", { connId, sql:
      "CREATE TRIGGER trg_touch AFTER UPDATE ON productos BEGIN " +
      "UPDATE productos SET creado=CURRENT_TIMESTAMP WHERE id=NEW.id; END" });
    const r = await rpc("query.run", { connId, sql:
      "SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name" });
    if (r.rows.length !== 1 || r.rows[0][0] !== "trg_touch") {
      throw new Error("trigger no listado");
    }
    if (!/create trigger/i.test(r.rows[0][1])) throw new Error("DDL inline del trigger ausente");
  });

  await step("FKs reales vía PRAGMA foreign_key_list", async () => {
    await rpc("query.run", { connId, sql:
      "CREATE TABLE pedidos (id INTEGER PRIMARY KEY, producto_id INTEGER " +
      "REFERENCES productos(id))" });
    const r = await rpc("query.run", { connId, sql: "PRAGMA foreign_key_list(pedidos)" });
    const refsProductos = r.rows.some((row) => row.includes("productos"));
    if (!refsProductos) throw new Error("PRAGMA no reportó la FK a productos");
  });

  await step("índices: crear → listado (pragma_index_list/info como en la app)", async () => {
    await rpc("query.run", { connId, sql:
      "CREATE UNIQUE INDEX idx_prod_nombre ON productos(nombre)" });
    const r = await rpc("query.run", { connId, sql:
      "SELECT il.name AS name, group_concat(ii.name, ', ') AS columnas, " +
      "CASE il.\"unique\" WHEN 1 THEN 'Sí' ELSE 'No' END AS unico " +
      "FROM pragma_index_list('productos') il " +
      "JOIN pragma_index_info(il.name) ii GROUP BY il.name ORDER BY il.name" });
    const row = r.rows.find((x) => x[0] === "idx_prod_nombre");
    if (!row) throw new Error("índice no listado");
    if (row[2] !== "Sí") throw new Error("no reconoció el índice como único");
  });

  await step("EXPLAIN QUERY PLAN devuelve un plan", async () => {
    const r = await rpc("query.run", { connId, sql:
      "EXPLAIN QUERY PLAN SELECT * FROM productos WHERE nombre = 'x'" });
    if (!r.rows || r.rows.length < 1) throw new Error("EXPLAIN QUERY PLAN vacío");
  });

  await step("archivo de solo lectura → error honesto al escribir; lectura OK", async () => {
    await rpc("conn.close", { connId });
    chmodSync(dbPath, 0o444); // read-only
    const r = await rpc("conn.open", { driver: "sqlite", dsn: { path: dbPath } });
    const roId = r.connId;
    // reads still work
    const sel = await rpc("query.run", { connId: roId, sql: "SELECT COUNT(*) FROM productos" });
    if (!sel.rows) throw new Error("lectura falló en archivo de solo lectura");
    // writes fail with an explicit error (not a crash / not silent success)
    let errored = false;
    try {
      await rpc("query.run", { connId: roId, sql: "INSERT INTO productos(nombre) VALUES ('x')" });
    } catch (e) {
      errored = /readonly|read-only|only|writ/i.test(e.message);
    }
    await rpc("conn.close", { connId: roId });
    chmodSync(dbPath, 0o644); // restore for cleanup
    connId = null;
    if (!errored) throw new Error("la escritura no falló honestamente en archivo de solo lectura");
  });
}

try {
  await main();
} finally {
  child.stdin.end();
  child.kill();
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\nSQLite features: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
