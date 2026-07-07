#!/usr/bin/env node
// Reproducible smoke test for the Quaero MCP server (issue #184). Spawns the
// real `quaero-mcp` binary and drives it over stdio (newline-delimited JSON),
// asserting the security model against a throwaway SQLite database:
//   initialize → tools/list → list_connections (no secrets, opt-in filter)
//   → write on a writable connection (allowed)
//   → read on a read-only connection (allowed, rows round-trip)
//   → DROP and "SELECT 1; DROP TABLE t" on the read-only connection (refused)
//   → a non-opted-in connection is invisible.
//
// Usage:  node mcp.mjs [driversDir]
//   driversDir  dir with the sqlite plugin (default: build/drivers/sqlite)
//   QUAERO_MCP  path to quaero-mcp[.exe] (default: build/tools/quaero-mcp[.exe])
//
// Exit code 0 = all checks passed, 1 = a check failed, 2 = harness error.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";

const driversDir = process.argv[2] ?? "build/drivers/sqlite";
const exe =
  process.env.QUAERO_MCP ??
  (platform() === "win32" ? "build/tools/quaero-mcp/quaero-mcp.exe"
                          : "build/tools/quaero-mcp/quaero-mcp");
if (!existsSync(exe)) {
  console.error(`quaero-mcp not found at ${exe} (build the quaero-mcp target first)`);
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "quaero-mcp-smoke-"));
const dbPath = join(dir, "test.db").replaceAll("\\", "/");
const connsPath = join(dir, "connections.json");
writeFileSync(
  connsPath,
  JSON.stringify({
    version: 1,
    connections: [
      { id: "ro", name: "ReadOnly", driver: "sqlite", params: { path: dbPath }, mcp: true },
      { id: "rw", name: "Writable", driver: "sqlite", params: { path: dbPath }, mcp: true, mcpWrite: true },
      { id: "hidden", name: "Hidden", driver: "sqlite", params: { path: dbPath } },
    ],
  }),
);

const child = spawn(exe, ["--connections", connsPath, "--drivers", driversDir], {
  stdio: ["pipe", "pipe", "inherit"],
});
const rl = createInterface({ input: child.stdout });
const pending = new Map();
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const r = pending.get(msg.id);
  if (r) { pending.delete(msg.id); r(msg); }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
// A tool call returns the text of the first content item + its isError flag.
async function call(name, args) {
  const resp = await rpc("tools/call", { name, arguments: args });
  const text = resp.result?.content?.[0]?.text ?? "";
  return { text, isError: !!resp.result?.isError };
}

let failures = 0;
function check(cond, label) {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) failures++;
}

try {
  const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
  check(init.result?.serverInfo?.name === "quaero", "initialize returns serverInfo");
  check(!!init.result?.capabilities?.tools, "advertises tools capability");

  const list = await rpc("tools/list");
  const toolNames = (list.result?.tools ?? []).map((t) => t.name).sort();
  check(
    JSON.stringify(toolNames) === JSON.stringify(["list_connections", "query_run", "schema_describe", "schema_tree"]),
    "tools/list has the four tools",
  );

  const conns = await call("list_connections", {});
  check(!conns.isError && conns.text.includes("ReadOnly") && conns.text.includes("Writable"), "list_connections returns opted-in connections");
  check(!conns.text.includes("Hidden"), "non-opted-in connection is hidden");
  check(!/password|params|path/i.test(conns.text), "list_connections leaks no credentials/DSN");

  const create = await call("query_run", { connection: "rw", sql: "CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT)" });
  check(!create.isError, "DDL allowed on writable connection");
  const ins = await call("query_run", { connection: "rw", sql: "INSERT INTO t(name) VALUES ('ada'),('bob')" });
  check(!ins.isError, "INSERT allowed on writable connection");

  const sel = await call("query_run", { connection: "ro", sql: "SELECT id,name FROM t ORDER BY id" });
  check(!sel.isError && sel.text.includes("ada") && sel.text.includes("bob"), "SELECT allowed on read-only connection and rows round-trip");

  const cte = await call("query_run", { connection: "ro", sql: "WITH x AS (SELECT 1 AS n) SELECT * FROM x" });
  check(!cte.isError, "read-only CTE allowed");

  const drop = await call("query_run", { connection: "ro", sql: "DROP TABLE t" });
  check(drop.isError && /refused/i.test(drop.text), "DROP refused on read-only connection");

  const multi = await call("query_run", { connection: "ro", sql: "SELECT 1; DROP TABLE t" });
  check(multi.isError && /refused/i.test(multi.text), "multi-statement write evasion refused");

  const dropCte = await call("query_run", { connection: "ro", sql: "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d" });
  check(dropCte.isError && /refused/i.test(dropCte.text), "data-modifying CTE refused");

  const hidden = await call("query_run", { connection: "hidden", sql: "SELECT 1" });
  check(hidden.isError && /unknown connection/i.test(hidden.text), "hidden connection cannot be queried");
} finally {
  child.stdin.end();
  child.kill();
}

console.log(failures === 0 ? "\nMCP smoke: all checks passed" : `\nMCP smoke: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
