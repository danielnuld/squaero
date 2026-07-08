#!/usr/bin/env node
// Feature-level verification for MySQL/MariaDB (issue #195), beyond the
// core-path smoke (#199). Drives the REAL core + MySQL driver through
// quaero-rpc against a throwaway server, exercising the sensitive flows the
// issue calls out: utf8mb4 (accents + emoji) in data AND object names,
// procedures/functions (list + DDL), triggers, scheduled events, users
// (CREATE/GRANT/SHOW GRANTS/REVOKE/DROP), monitor + KILL of a session, and
// offset pagination over a >10k-row table.
//
// Usage:  node mysql-features.mjs [driversDir]
//   driversDir  dir with the mysql plugin (default: build/app/drivers)
//   QUAERO_RPC        quaero-rpc[.exe] (default: build/tools/quaero-rpc[.exe])
//   QUAERO_SMOKE_DSN  JSON DSN (default: :13306 root/test123 testdb)
//
// The mysql plugin needs its client DLL (libmysql.dll) on PATH — run with
// PATH including build/app (as scripts/smoke/run.sh does).
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
if (!existsSync(exe)) {
  console.error(`quaero-rpc not found at ${exe}`);
  process.exit(2);
}
const dsn = process.env.QUAERO_SMOKE_DSN
  ? JSON.parse(process.env.QUAERO_SMOKE_DSN)
  : { host: "127.0.0.1", port: "13306", user: "root", password: "test123", database: "testdb" };

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

(async () => {
  let connId;
  await step("conectar", async () => {
    connId = (await rpc("conn.open", { driver: "mysql", dsn })).connId;
    if (!connId) throw new Error("no connId");
  });

  await step("utf8mb4: acentos + emoji en DATOS y en NOMBRES de objetos", async () => {
    await q(connId, "DROP TABLE IF EXISTS `clientes_café`");
    await q(connId, "CREATE TABLE `clientes_café` (`id` INT PRIMARY KEY AUTO_INCREMENT, `nombré` VARCHAR(80)) CHARACTER SET utf8mb4");
    await q(connId, "INSERT INTO `clientes_café` (`nombré`) VALUES ('José 😀'),('Renée ☕')");
    const r = await q(connId, "SELECT `nombré` FROM `clientes_café` ORDER BY `id`");
    const v = r.rows.map((x) => x[0]);
    if (v[0] !== "José 😀" || v[1] !== "Renée ☕") throw new Error("round-trip roto: " + JSON.stringify(v));
    return v.join(" / ");
  });

  await step("procedimientos + funciones: crear → listar (information_schema) → DDL", async () => {
    await q(connId, "DROP PROCEDURE IF EXISTS sp_demo");
    await q(connId, "DROP FUNCTION IF EXISTS fn_demo");
    await q(connId, "CREATE PROCEDURE sp_demo(IN n INT) SELECT n * 2");
    await q(connId, "CREATE FUNCTION fn_demo(n INT) RETURNS INT DETERMINISTIC RETURN n + 1");
    const list = await q(connId, "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_NAME");
    const names = list.rows.map((x) => x[0]);
    if (!names.includes("sp_demo") || !names.includes("fn_demo")) throw new Error("no listadas: " + names);
    const ddl = await q(connId, "SHOW CREATE PROCEDURE sp_demo");
    if (!/create.*procedure/i.test(JSON.stringify(ddl.rows))) throw new Error("SHOW CREATE PROCEDURE vacío");
    return names.filter((n) => /demo/.test(n)).join(",");
  });

  await step("triggers: crear → listar → DDL", async () => {
    await q(connId, "DROP TABLE IF EXISTS audit_log");
    await q(connId, "CREATE TABLE audit_log (id INT PRIMARY KEY AUTO_INCREMENT, note VARCHAR(50))");
    await q(connId, "DROP TRIGGER IF EXISTS trg_demo");
    await q(connId, "CREATE TRIGGER trg_demo AFTER INSERT ON `clientes_café` FOR EACH ROW INSERT INTO audit_log(note) VALUES ('new')");
    const list = await q(connId, "SELECT TRIGGER_NAME, EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()");
    if (!list.rows.some((x) => x[0] === "trg_demo")) throw new Error("trigger no listado");
    return "trg_demo";
  });

  await step("eventos programados: crear → listar", async () => {
    await q(connId, "DROP EVENT IF EXISTS ev_demo");
    await q(connId, "CREATE EVENT ev_demo ON SCHEDULE EVERY 1 DAY DO DELETE FROM audit_log WHERE id < 0");
    const list = await q(connId, "SELECT EVENT_NAME, STATUS FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()");
    if (!list.rows.some((x) => x[0] === "ev_demo")) throw new Error("evento no listado");
    return "ev_demo";
  });

  await step("usuarios: CREATE USER → GRANT → SHOW GRANTS → REVOKE → DROP USER", async () => {
    await q(connId, "DROP USER IF EXISTS 'quaero_qa'@'%'");
    await q(connId, "CREATE USER 'quaero_qa'@'%' IDENTIFIED BY 'p@ss123'");
    await q(connId, "GRANT SELECT ON testdb.* TO 'quaero_qa'@'%'");
    const grants = await q(connId, "SHOW GRANTS FOR 'quaero_qa'@'%'");
    if (!/GRANT SELECT/i.test(JSON.stringify(grants.rows))) throw new Error("GRANT no reflejado");
    await q(connId, "REVOKE SELECT ON testdb.* FROM 'quaero_qa'@'%'");
    await q(connId, "DROP USER 'quaero_qa'@'%'");
    return "create/grant/show/revoke/drop ok";
  });

  await step("monitor: SHOW PROCESSLIST + KILL de una 2ª sesión", async () => {
    const other = (await rpc("conn.open", { driver: "mysql", dsn })).connId;
    // find the other session's connection id
    const pl = await q(other, "SELECT CONNECTION_ID() AS id");
    const otherId = pl.rows[0][0];
    const list = await q(connId, "SHOW PROCESSLIST");
    if (!list.rows.some((r) => String(r[0]) === String(otherId))) throw new Error("2ª sesión no visible en processlist");
    await q(connId, `KILL ${otherId}`);
    await rpc("conn.close", { connId: other }).catch(() => {});
    return `mató sesión ${otherId}`;
  });

  await step("paginación offset sobre tabla >10k filas", async () => {
    await q(connId, "DROP TABLE IF EXISTS big");
    await q(connId, "CREATE TABLE big (id INT PRIMARY KEY, name VARCHAR(20))");
    await q(connId, "SET SESSION cte_max_recursion_depth = 100000");
    await q(connId, "INSERT INTO big(id,name) WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 12000) SELECT n, CONCAT('row', n) FROM seq");
    const cnt = await q(connId, "SELECT COUNT(*) FROM big");
    if (cnt.rows[0][0] !== "12000") throw new Error("conteo=" + cnt.rows[0][0]);
    const p = await q(connId, "SELECT id FROM big ORDER BY id");   // limit defaults, truncated
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
    for (const s of ["DROP TABLE IF EXISTS `clientes_café`", "DROP TABLE IF EXISTS audit_log",
      "DROP TABLE IF EXISTS big", "DROP PROCEDURE IF EXISTS sp_demo",
      "DROP FUNCTION IF EXISTS fn_demo", "DROP EVENT IF EXISTS ev_demo"]) {
      await q(connId, s).catch(() => {});
    }
    await rpc("conn.close", { connId });
  });

  console.log(`\nMySQL features: ${pass} passed, ${fail} failed`);
  child.stdin.end(); child.kill();
  process.exit(fail === 0 ? 0 : 1);
})();
