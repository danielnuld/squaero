// Manual transactions in the editor (issue #667).
//
// A transaction lives on the core connection, so the mode and its state are per
// connection: every tab bound to it shares them. In auto-commit mode statements
// run as they always did. In manual mode the first statement that is not a plain
// read opens a transaction (tx.begin) and everything after runs inside it until
// Commit or Rollback.
//
// What the user TYPES is kept consistent with the indicator: a bare BEGIN /
// COMMIT / ROLLBACK runs as tx.* instead of query.run, so the core's own
// "transaction open" flag (which refuses a nested tx.begin) never drifts from the
// engine's. A BEGIN with options (isolation level, READ ONLY…) cannot be handed
// to tx.begin, so it runs as typed and only the indicator learns of it.
//
// MySQL/MariaDB commit an open transaction by themselves before DDL (implicit
// commit). That cannot be prevented, only said: the statement runs outside any
// transaction and the open one is reported as committed.

import { scrub } from "./queryTarget";
import { engineFamily } from "./engineFamily";
import { t } from "./i18n";

export type TxVerb = "begin" | "commit" | "rollback";

/** A statement that starts or ends a transaction. `bare` = only the verb and its
    noise words, so tx.* can run in its place. */
export interface TxStatement {
  verb: TxVerb;
  bare: boolean;
}

const NOISE = "(?:\\s+(?:work|transaction|tran))?";
const BARE_BEGIN = new RegExp(`^(?:begin${NOISE}|start transaction)$`);
const BARE_COMMIT = new RegExp(`^(?:commit|end)${NOISE}$`);
const BARE_ROLLBACK = new RegExp(`^(?:rollback|abort)${NOISE}$`);
// A begin with options. BEGIN alone is also how a procedural block opens
// (`BEGIN … END`, `BEGIN TRY`), so only words that can follow a transactional
// BEGIN count.
const BEGIN_WITH_OPTIONS =
  /^(?:start transaction\b|begin (?:work|transaction|tran|deferred|immediate|exclusive|isolation|read|not|deferrable)\b)/;

/** The text that decides: no comments, no trailing `;`, one space, lower case. */
function normalized(sql: string): string {
  return scrub(sql).replace(/[;\s]+$/, "").toLowerCase();
}

/**
 * Whether `sql` (one statement) starts or ends a transaction, or null. COMMIT
 * and ROLLBACK count only bare: `ROLLBACK TO SAVEPOINT x` and `COMMIT AND
 * CHAIN` leave a transaction open, so they are ordinary statements here. Pure.
 */
export function classifyTxStatement(sql: string): TxStatement | null {
  const s = normalized(sql);
  if (BARE_BEGIN.test(s)) return { verb: "begin", bare: true };
  if (BARE_COMMIT.test(s)) return { verb: "commit", bare: true };
  if (BARE_ROLLBACK.test(s)) return { verb: "rollback", bare: true };
  if (BEGIN_WITH_OPTIONS.test(s)) return { verb: "begin", bare: false };
  return null;
}

// MySQL's implicit-commit statements (the common ones). CREATE/DROP TEMPORARY
// TABLE are the documented exception.
const IMPLICIT_COMMIT = /^(?:create|drop|alter|rename|truncate|grant|revoke|lock|unlock)\b/;
const TEMPORARY = /^(?:create|drop) temporary\b/;

/** True when the engine commits an open transaction by itself before running
    `sql` — DDL on MySQL/MariaDB. Engines with transactional DDL: never. Pure. */
export function commitsImplicitly(sql: string, engine: string): boolean {
  if (engineFamily(engine) !== "mysql") return false;
  const s = normalized(sql);
  return IMPLICIT_COMMIT.test(s) && !TEMPORARY.test(s);
}

// Statements that only read. Manual mode opens its transaction on the first one
// that is NOT: a SELECT on its own changes nothing worth committing, and a grid
// refresh (which re-runs the tab's query) must not open one behind the user's
// back. Locking or writing selects count as writes.
const READS = /^(?:select|show|describe|desc|explain|values|table)\b/;
const WRITING_SELECT = /\bfor (?:update|share|no key update|key share)\b|\binto\b|\block in\b/;
// A CTE reads unless one of its parts writes (PostgreSQL allows DML in WITH).
const WITH_READ = /^with\b/;
const DML_WORD = /\b(?:insert|update|delete|merge)\b/;

/** True when `sql` only reads (by its leading verb). Fail-closed: anything
    unrecognised is not, and a WITH reads only when no part of it writes. Pure. */
export function readsOnly(sql: string): boolean {
  const s = normalized(sql);
  if (WITH_READ.test(s)) return !DML_WORD.test(s) && !WRITING_SELECT.test(s);
  return READS.test(s) && !WRITING_SELECT.test(s);
}

/** A connection's transaction state, as the editor sees it. */
export interface TxSession {
  /** Manual mode: the first statement opens a transaction. */
  manual: boolean;
  /** A transaction is open (manual mode, or a BEGIN the user typed). */
  open: boolean;
  /** Statements run inside the open transaction. */
  statements: number;
  /** Those statements, oldest first, with the rows each changed when known —
      what the transaction band lists and the disconnect prompt names (M14). */
  log?: TxEntry[];
}

/** One statement of the open transaction. */
export interface TxEntry {
  sql: string;
  /** Rows it changed; null when the engine did not say. */
  rows: number | null;
}

export const idleTx = (manual = false): TxSession => ({ manual, open: false, statements: 0, log: [] });

/** What running one statement takes. */
export type TxStep =
  /** tx.* runs in the statement's place. */
  | { kind: "tx"; verb: TxVerb }
  /** A BEGIN while a transaction is open: refused, never sent. */
  | { kind: "refuse" }
  /** query.run, after a tx.begin when `beginFirst`. */
  | { kind: "run"; beginFirst: boolean; opens: boolean; implicitCommit: boolean };

/** Decide how to run `sql` given the connection's state. Pure. */
export function planStatement(s: TxSession, sql: string, engine: string): TxStep {
  const c = classifyTxStatement(sql);
  if (c?.verb === "begin") {
    if (s.open) return { kind: "refuse" };
    return c.bare
      ? { kind: "tx", verb: "begin" }
      : { kind: "run", beginFirst: false, opens: true, implicitCommit: false };
  }
  if (c) return { kind: "tx", verb: c.verb };
  if (commitsImplicitly(sql, engine)) {
    // Opening a transaction just for the engine to commit it is pointless.
    return { kind: "run", beginFirst: false, opens: false, implicitCommit: s.open };
  }
  return {
    kind: "run",
    beginFirst: s.manual && !s.open && !readsOnly(sql),
    opens: false,
    implicitCommit: false,
  };
}

/** The effects runInTx needs, injected so the order of calls is unit-tested. */
export interface TxEffects<R> {
  get: () => TxSession;
  set: (s: TxSession) => void;
  query: () => Promise<R>;
  tx: (verb: TxVerb) => Promise<void>;
  /** The result shown for a statement tx.* ran in place of. */
  empty: () => R;
  /** The engine committed the open transaction by itself (MySQL DDL). */
  onImplicitCommit?: () => void;
  /** Rows a statement's result changed, for the log; absent: not known. */
  rows?: (r: R) => number | null;
}

/** Thrown for a BEGIN while a transaction is open. */
export class TxAlreadyOpenError extends Error {
  constructor() {
    super(t("tx.alreadyOpen"));
    this.name = "TxAlreadyOpenError";
  }
}

/**
 * Run one statement through the connection's transaction state: tx.* in place
 * of a bare BEGIN/COMMIT/ROLLBACK, a tx.begin before the first statement in
 * manual mode, and the state updated whatever the outcome. Rejects with the
 * statement's (or tx.*'s) error.
 */
export async function runInTx<R>(sql: string, engine: string, fx: TxEffects<R>): Promise<R> {
  const s = fx.get();
  const step = planStatement(s, sql, engine);
  if (step.kind === "refuse") throw new TxAlreadyOpenError();
  if (step.kind === "tx") {
    try {
      await fx.tx(step.verb);
    } catch (err) {
      // A failed rollback leaves nothing to end (the core clears its flag too);
      // a failed begin or commit leaves things as they were.
      if (step.verb === "rollback") fx.set({ ...s, open: false, statements: 0, log: [] });
      throw err;
    }
    fx.set({ ...s, open: step.verb === "begin", statements: 0, log: [] });
    return fx.empty();
  }
  let cur = s;
  if (step.beginFirst) {
    await fx.tx("begin");
    cur = { ...s, open: true, statements: 0, log: [] };
    fx.set(cur);
  }
  let ok = false;
  let rows: number | null = null;
  try {
    const r = await fx.query();
    ok = true;
    rows = fx.rows?.(r) ?? null;
    return r;
  } finally {
    if (step.implicitCommit) {
      // MySQL already committed; this only ends the core's bookkeeping of a
      // transaction tx.begin opened (a COMMIT with none open is a no-op there).
      await fx.tx("commit").catch(() => {});
      fx.set({ ...cur, open: false, statements: 0, log: [] });
      fx.onImplicitCommit?.();
    } else if (step.opens) {
      if (ok) fx.set({ ...cur, open: true, statements: 0, log: [] });
    } else if (cur.open) {
      // A failed statement is still part of the transaction's story (engines
      // like PostgreSQL abort it): listed, with no row count.
      fx.set({
        ...cur,
        statements: cur.statements + 1,
        log: [...(cur.log ?? []), { sql: sql.trim(), rows }],
      });
    }
  }
}
