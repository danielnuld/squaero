// A live JSON-RPC client over the real `quaero-rpc` bridge: one child process
// holding the real C core with the real driver plugins loaded.
//
// Two kinds of caller share one process, which is why ids are namespaced:
//   - the browser page, whose ids come from the frontend's own counter (1, 2, 3…)
//   - the harness itself, seeding and asserting, using "h1", "h2"… so it can never
//     collide with the page and steal its response.
//
// Responses are matched by id, NOT by arrival order. The core dispatches
// op.cancel WITHOUT queueing it behind the running query — that is the whole point
// of the method — so a cancel answers before the query it cancels. Pairing by
// order would work until the first cancellation test and then fail intermittently.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface RpcClient {
  /** Sends a request the harness composed. Namespaced ids, never the page's. */
  call(method: string, params?: unknown): Promise<JsonRpcResponse>;
  /** Sends a request the page composed, verbatim, keeping its own id. */
  forward(requestJson: string): Promise<JsonRpcResponse>;
  /** Driver names the core actually registered, from the child's stderr. */
  loadedDrivers(): readonly string[];
  close(): Promise<void>;
}

/** Repo root, from frontend/e2e/support/ upwards. */
const REPO = join(import.meta.dirname, "..", "..", "..");

const IS_WIN = process.platform === "win32";

/**
 * The x86 build is the default because it is the only one that loads all five
 * drivers: the IBM Informix ODBC driver is 32-bit only, so an x64 Quaero cannot
 * talk to Informix at all.
 */
function defaultBinary(): string {
  return IS_WIN
    ? join(REPO, "build-x86", "tools", "quaero-rpc.exe")
    : join(REPO, "build", "tools", "quaero-rpc");
}

function defaultDrivers(): string {
  return IS_WIN
    ? join(REPO, "build-x86", "app", "drivers")
    : join(REPO, "build", "app", "drivers");
}

export function binaryPath(): string {
  return process.env.QUAERO_RPC ?? defaultBinary();
}

export function driversPath(): string {
  return process.env.QUAERO_DRIVERS ?? defaultDrivers();
}

export interface CoreTarget {
  readonly binary: string;
  readonly drivers: string;
}

export function defaultTarget(): CoreTarget {
  return { binary: binaryPath(), drivers: driversPath() };
}

/**
 * Runtime DLLs the plugins need are staged next to the app, not next to
 * quaero-rpc, so loading them from the tools directory fails with a bare
 * "could not load library" that explains nothing. Putting both app directories
 * and the 32-bit mingw runtime on the child's PATH turns that lost afternoon
 * into a non-event. Harmless where the directories do not exist.
 */
function childPath(): string {
  const extra = [
    join(REPO, "build-x86", "app"),
    join(REPO, "build", "app"),
    "C:\\mingw32\\bin",
  ].filter((p) => existsSync(p));
  return [...extra, process.env.PATH ?? ""].join(delimiter);
}

interface Pending {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  what: string;
}

export async function startRpc(target: CoreTarget = defaultTarget()): Promise<RpcClient> {
  const bin = target.binary;
  if (!existsSync(bin)) {
    throw new Error(
      `quaero-rpc not found at ${bin}. Build it first ` +
        `(cmake --build build-x86 --target quaero-rpc) or set QUAERO_RPC.`,
    );
  }

  const child: ChildProcessWithoutNullStreams = spawn(bin, [target.drivers], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PATH: childPath() },
  }) as ChildProcessWithoutNullStreams;

  const pending = new Map<string, Pending>();
  const drivers: string[] = [];
  let dead: Error | null = null;

  const stdout: Interface = createInterface({ input: child.stdout });
  stdout.on("line", (line) => {
    if (line.trim() === "") {
      return;
    }
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return; // not a response line; ignore rather than kill the run
    }
    const waiter = pending.get(String(response.id));
    if (waiter !== undefined) {
      pending.delete(String(response.id));
      waiter.resolve(response);
    }
  });

  // The child announces each plugin it registers on stderr. Keeping the list lets
  // a test skip on "driver not loaded" instead of failing on "unknown driver".
  const stderr = createInterface({ input: child.stderr });
  stderr.on("line", (line) => {
    const match = /loaded driver '([^']+)'/.exec(line);
    if (match?.[1] !== undefined) {
      drivers.push(match[1]);
    }
  });

  const die = (why: string) => {
    dead = new Error(`quaero-rpc ${why}`);
    for (const [, waiter] of pending) {
      // Reject rather than leave the promise hanging: a dead bridge that never
      // answers produces the exact symptom these tests exist to catch, and
      // mistaking one for the other would cost an afternoon.
      waiter.reject(new Error(`quaero-rpc ${why} while waiting for ${waiter.what}`));
    }
    pending.clear();
  };
  child.on("exit", (code, signal) =>
    die(`exited (code ${String(code)}, signal ${String(signal)})`),
  );
  child.on("error", (err) => die(`failed to start: ${err.message}`));

  // Give the loader a moment to register the plugins so loadedDrivers() is
  // meaningful on the first call; the handshake below also proves it answers.
  const ready = new Promise<void>((resolve) => setTimeout(resolve, 250));

  let counter = 0;
  const send = (requestJson: string, id: string, what: string) =>
    new Promise<JsonRpcResponse>((resolve, reject) => {
      if (dead !== null) {
        reject(dead);
        return;
      }
      pending.set(id, { resolve, reject, what });
      child.stdin.write(requestJson + "\n", (err) => {
        if (err) {
          pending.delete(id);
          reject(err);
        }
      });
    });

  const client: RpcClient = {
    async call(method, params) {
      counter += 1;
      const id = `h${counter}`;
      const request =
        params === undefined
          ? { jsonrpc: "2.0", id, method }
          : { jsonrpc: "2.0", id, method, params };
      return send(JSON.stringify(request), id, method);
    },

    async forward(requestJson) {
      const parsed = JSON.parse(requestJson) as { id?: number | string; method?: string };
      if (parsed.id === undefined) {
        throw new Error(`page request without an id: ${requestJson}`);
      }
      return send(requestJson, String(parsed.id), parsed.method ?? "(unknown)");
    },

    loadedDrivers() {
      return drivers;
    },

    async close() {
      stdout.close();
      stderr.close();
      child.stdin.end();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        setTimeout(() => {
          child.kill();
          resolve();
        }, 2000);
      });
    },
  };

  await ready;
  return client;
}

/** Throws with the error message when the response carries one. */
export function unwrap(response: JsonRpcResponse, what: string): unknown {
  if (response.error !== undefined) {
    throw new Error(`${what} failed: ${response.error.message}`);
  }
  return response.result;
}
