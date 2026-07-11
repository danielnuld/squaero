#!/usr/bin/env node
// Feature-level verification for PostgreSQL (issues #22/#23, QA #197-class),
// beyond the core-path smoke (#199). Drives the REAL core + PostgreSQL driver
// through quaero-rpc against a throwaway server, exercising the PG-specific
// paths that the driver's *pure* unit tests (postgres_types_test /
// postgres_identifier_test / postgres_dml_test) do NOT cover — the ones that
// issue live catalog queries or use libpq state:
//   - UTF-8 (accents + emoji) in DATA and in quoted object NAMES
//   - real SCHEMAS (the DBC_FEAT_SCHEMAS differentiator): schema.tree lists a
//     non-public schema; schema.describe / schema.ddl honor the schema arg
//   - schema.describe format_type renderings + notnull/dflt_value/pk columns
//   - schema.ddl reconstructed CREATE TABLE (columns + DEFAULT + PRIMARY KEY),
//     and an honest error for a missing object
//   - end-to-end cell rendering + neutral column types for bool / numeric /
//     jsonb / uuid / timestamptz / bytea / int[] (arrays fall through to text)
//   - views + materialized views both reported as 'view' in the tree
//   - offset pagination over a >10k-row table
//   - transactional edit with a real ROLLBACK
//
// NOT covered here (by design): in-flight op.cancel. quaero-rpc is a single-
// threaded stdio loop — dbcore_ipc_handle() blocks until query.run returns, so
// a concurrent op.cancel can never reach the running op through one process.
// The threaded cancel path (PQcancel via the connect-time handle) is exercised
// by the core's op_cancel_test instead.
//
// Usage:  node postgres-features.mjs [driversDir]
//   driversDir        dir with the postgres plugin (default: build/app/drivers)
//   QUAERO_RPC        quaero-rpc[.exe] (default: build/tools/quaero-rpc[.exe])
//   QUAERO_SMOKE_DSN  JSON DSN (default: :15432 postgres/test123 testdb)
//
// Run against the x86 build: its libpq is statically linked (REL_16_9) and does
// SCRAM-SHA-256, PG16's default auth. The x64 dev build links Strawberry's libpq,
// which predates SCRAM, so the connect hangs until the server's authentication
// timeout. Recommended invocation (from repo root):
//   PATH="/c/mingw32/bin:$PWD/build-x86/app:$PATH" \
//     QUAERO_RPC=build-x86/tools/quaero-rpc.exe \
//     node scripts/smoke/postgres-features.mjs build-x86/app/drivers
// Exit code 0 = all passed, 1 = a check failed, 2 = harness error.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { platform } from "node:process";

const driversDir = process.argv[2] ?? "build/app/drivers";
const exe =
  process.env.QUAERO_RPC ??
  (platform === "win32" ? "build/tools/quaero-rpc.exe" : "build/tools/quaero-rpc");
if (!existsSync(exe)) {
  console.error(`quaero-rpc not found at ${exe}`);
  process.exit(2);
}
const dsn = process.env.QUAERO_SMOKE_DSN
  ? JSON.parse(process.env.QUAERO_SMOKE_DSN)
  : { host: "127.0.0.1", port: "15432", user: "postgres", password: "test123", database: "testdb" };

const child = spawn(exe, [driversDir], { stdio: ["pipe", "pipe", "inherit"] });
const rl = createInterface({ input: child.stdout });
const lines = [];
let waiter = null;
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
const q = (connId, sql) => rpc("query.run", { connId, sql });
// flatten a result's rows to a single searchable string
const flat = (r) => JSON.stringify(r.rows);

(async () => {
  let connId;
  await step("conectar", async () => {
    connId = (await rpc("conn.open", { driver: "postgres", dsn })).connId;
    if (!connId) throw new Error("no connId");
  });

  await step("UTF-8: acentos + emoji en DATOS y en NOMBRES de objetos", async () => {
    await q(connId, 'DROP TABLE IF EXISTS "clientes_café"');
    await q(connId, 'CREATE TABLE "clientes_café" ("id" serial PRIMARY KEY, "nombré" varchar(80))');
    await q(connId, `INSERT INTO "clientes_café" ("nombré") VALUES ('José 😀'),('Renée ☕')`);
    const r = await q(connId, 'SELECT "nombré" FROM "clientes_café" ORDER BY "id"');
    const v = r.rows.map((x) => x[0]);
    if (v[0] !== "José 😀" || v[1] !== "Renée ☕") throw new Error("round-trip roto: " + JSON.stringify(v));
    return v.join(" / ");
  });

  await step("esquemas reales (SCHEMAS): crear schema + tabla → schema.tree lo lista", async () => {
    await q(connId, "DROP SCHEMA IF EXISTS ventas CASCADE");
    await q(connId, "CREATE SCHEMA ventas");
    await q(connId, "CREATE TABLE ventas.pedidos (id serial PRIMARY KEY, monto numeric(10,2))");
    // tree with no params lists DATABASES; pass db to list the connected db's SCHEMAS
    const schemas = await rpc("schema.tree", { connId, db: dsn.database });
    if (!flat(schemas).includes("ventas")) throw new Error("schema 'ventas' no aparece en schema.tree(db): " + flat(schemas));
    // tree scoped to the schema should list its table
    const inside = await rpc("schema.tree", { connId, schema: "ventas" });
    if (!flat(inside).includes("pedidos")) throw new Error("tabla 'pedidos' no listada bajo ventas: " + flat(inside));
    return "ventas → pedidos";
  });

  await step("describe: format_type + notnull/dflt_value/pk (PK compuesta)", async () => {
    await q(connId, "DROP TABLE IF EXISTS ventas.factura");
    await q(connId,
      "CREATE TABLE ventas.factura (" +
      " serie varchar(4) NOT NULL," +
      " folio integer NOT NULL," +
      " total numeric(10,2) DEFAULT 0," +
      " creado timestamptz DEFAULT now()," +
      " PRIMARY KEY (serie, folio))");
    const d = await rpc("schema.describe", { connId, table: "factura", schema: "ventas" });
    // columns of the describe result: name,type,notnull,dflt_value,pk
    const ci = Object.fromEntries(d.columns.map((c, i) => [c.name, i]));
    const byName = Object.fromEntries(d.rows.map((r) => [r[ci.name], r]));
    const typeOf = (n) => String(byName[n][ci.type]);
    if (!/character varying\(4\)/.test(typeOf("serie"))) throw new Error("serie type=" + typeOf("serie"));
    if (!/numeric\(10,2\)/.test(typeOf("total"))) throw new Error("total type=" + typeOf("total"));
    if (!/timestamp with time zone/.test(typeOf("creado"))) throw new Error("creado type=" + typeOf("creado"));
    const pkOf = (n) => byName[n][ci.pk];
    const isPk = (v) => v === true || v === 1 || v === "1" || v === "t" || v === "true";
    if (!isPk(pkOf("serie")) || !isPk(pkOf("folio"))) throw new Error("PK compuesta no marcada: " + flat(d));
    if (isPk(pkOf("total"))) throw new Error("columna no-PK marcada como PK");
    const dflt = String(byName["total"][ci.dflt_value] ?? "");
    if (!/0/.test(dflt)) throw new Error("dflt_value de total vacío: " + dflt);
    return "varchar(4)/numeric(10,2)/timestamptz, PK(serie,folio), default total=0";
  });

  await step("get_ddl (schema.ddl): CREATE TABLE reconstruido + PRIMARY KEY + DEFAULT", async () => {
    const r = await rpc("schema.ddl", { connId, object: "factura", schema: "ventas" });
    const ddl = r.rows?.[0]?.[0] ?? "";
    for (const needle of ["CREATE TABLE", '"serie"', '"total"', "PRIMARY KEY", "DEFAULT"]) {
      if (!ddl.includes(needle)) throw new Error(`DDL sin "${needle}": ${ddl}`);
    }
    // honest error for a non-existent object
    let errored = false;
    await rpc("schema.ddl", { connId, object: "no_existe_xyz", schema: "ventas" }).catch(() => { errored = true; });
    if (!errored) throw new Error("objeto inexistente no dio error");
    return "reconstruido + error honesto en objeto inexistente";
  });

  await step("tipos end-to-end: bool/numeric/jsonb/uuid/timestamptz/bytea/int[]", async () => {
    const r = await q(connId,
      "SELECT true::bool AS b, 12.34::numeric(6,2) AS n, '{\"a\":1}'::jsonb AS j," +
      " '11111111-1111-1111-1111-111111111111'::uuid AS u," +
      " '2026-07-11 10:00:00+00'::timestamptz AS ts," +
      " '\\xdeadbeef'::bytea AS bin, ARRAY[1,2,3]::int[] AS arr");
    const t = Object.fromEntries(r.columns.map((c) => [c.name, c.type]));
    const want = { b: "bool", n: "float", j: "json", u: "text", ts: "timestamp", bin: "blob", arr: "text" };
    for (const [col, exp] of Object.entries(want)) {
      if (t[col] !== exp) throw new Error(`col ${col}: tipo=${t[col]} esperado=${exp}`);
    }
    const row = r.rows[0];
    if (row.some((v) => typeof v !== "string")) throw new Error("algún valor no llegó como string: " + flat(r));
    const j = row[r.columns.findIndex((c) => c.name === "j")];
    if (!/"a"\s*:\s*1/.test(j)) throw new Error("jsonb mal renderizado: " + j);
    return "bool/float/json/text/timestamp/blob/text";
  });

  await step("vistas + vista materializada: ambas 'view' en el árbol", async () => {
    await q(connId, "DROP VIEW IF EXISTS ventas.v_factura");
    await q(connId, "DROP MATERIALIZED VIEW IF EXISTS ventas.mv_factura");
    await q(connId, "CREATE VIEW ventas.v_factura AS SELECT serie, folio FROM ventas.factura");
    await q(connId, "CREATE MATERIALIZED VIEW ventas.mv_factura AS SELECT serie FROM ventas.factura");
    const t = await rpc("schema.tree", { connId, schema: "ventas" });
    const s = flat(t);
    if (!s.includes("v_factura")) throw new Error("vista no listada: " + s);
    if (!s.includes("mv_factura")) throw new Error("matview no listada: " + s);
    // both should be typed as 'view' (matview reported as view by the driver)
    const views = t.rows.filter((r) => /factura$/.test(r[0]) && r.some((c) => c === "view"));
    if (views.length < 2) throw new Error("vista/matview no tipadas como 'view': " + s);
    return "v_factura + mv_factura → view";
  });

  await step("paginación offset sobre tabla >10k filas", async () => {
    await q(connId, "DROP TABLE IF EXISTS big");
    await q(connId, "CREATE TABLE big AS SELECT g AS id, 'row'||g AS name FROM generate_series(1,12000) g");
    const cnt = await q(connId, "SELECT COUNT(*) FROM big");
    if (cnt.rows[0][0] !== "12000") throw new Error("conteo=" + cnt.rows[0][0]);
    const p = await q(connId, "SELECT id FROM big ORDER BY id");   // default limit → truncated
    if (!p.truncated) throw new Error("no marcó truncated en 12k filas");
    const near = await rpc("query.run", { connId, sql: "SELECT id FROM big ORDER BY id", limit: 5, offset: 11995 });
    if (near.rows[0][0] !== "11996") throw new Error("offset final incorrecto: " + near.rows[0][0]);
    return "12k filas, offset 11995 → id 11996";
  });

  await step("edición transaccional con rollback real", async () => {
    await rpc("tx.begin", { connId });
    await rpc("row.insert", { connId, table: "big", values: { id: "999999", name: "temp" } });
    await rpc("tx.rollback", { connId });
    const r = await q(connId, "SELECT COUNT(*) FROM big WHERE id = 999999");
    if (r.rows[0][0] !== "0") throw new Error("rollback no deshizo el insert");
    return "insert + rollback → 0 filas";
  });

  await step("limpiar", async () => {
    for (const s of ['DROP TABLE IF EXISTS "clientes_café"', "DROP TABLE IF EXISTS big",
      "DROP SCHEMA IF EXISTS ventas CASCADE"]) {
      await q(connId, s).catch(() => {});
    }
    await rpc("conn.close", { connId });
  });

  console.log(`\nPostgreSQL features: ${pass} passed, ${fail} failed`);
  child.stdin.end(); child.kill();
  process.exit(fail === 0 ? 0 : 1);
})();
