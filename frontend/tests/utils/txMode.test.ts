import { describe, it, expect } from "vitest";
import {
  classifyTxStatement,
  commitsImplicitly,
  planStatement,
  readsOnly,
  runInTx,
  idleTx,
  TxAlreadyOpenError,
  type TxSession,
  type TxVerb,
} from "../../src/utils/txMode";

describe("classifyTxStatement", () => {
  it("recognises the bare forms of every engine", () => {
    for (const sql of ["BEGIN", "begin;", "BEGIN WORK", "begin transaction", "BEGIN TRAN", "START TRANSACTION"]) {
      expect(classifyTxStatement(sql)).toEqual({ verb: "begin", bare: true });
    }
    for (const sql of ["COMMIT", "commit work;", "COMMIT TRANSACTION", "END", "end transaction"]) {
      expect(classifyTxStatement(sql)).toEqual({ verb: "commit", bare: true });
    }
    for (const sql of ["ROLLBACK", "rollback work", "ROLLBACK TRAN", "ABORT"]) {
      expect(classifyTxStatement(sql)).toEqual({ verb: "rollback", bare: true });
    }
  });

  it("ignores comments and surrounding whitespace", () => {
    expect(classifyTxStatement("  -- end it\n  COMMIT ; ")).toEqual({ verb: "commit", bare: true });
    expect(classifyTxStatement("/* go */ begin")).toEqual({ verb: "begin", bare: true });
  });

  it("marks a begin with options as not bare", () => {
    for (const sql of [
      "START TRANSACTION READ ONLY",
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "BEGIN IMMEDIATE",
      "BEGIN TRANSACTION named_tx",
      "BEGIN WORK WITHOUT REPLICATION",
    ]) {
      expect(classifyTxStatement(sql)).toEqual({ verb: "begin", bare: false });
    }
  });

  it("does not take a procedural block or a savepoint for a transaction", () => {
    expect(classifyTxStatement("BEGIN NULL; END;")).toBeNull();
    expect(classifyTxStatement("BEGIN TRY SELECT 1 END TRY")).toBeNull();
    expect(classifyTxStatement("ROLLBACK TO SAVEPOINT a")).toBeNull();
    expect(classifyTxStatement("COMMIT AND CHAIN")).toBeNull();
    expect(classifyTxStatement("SELECT 'commit'")).toBeNull();
    expect(classifyTxStatement("")).toBeNull();
  });
});

describe("commitsImplicitly", () => {
  it("is true for DDL on MySQL and MariaDB", () => {
    expect(commitsImplicitly("CREATE TABLE t (id int)", "mysql")).toBe(true);
    expect(commitsImplicitly("drop table t", "mariadb")).toBe(true);
    expect(commitsImplicitly("ALTER TABLE t ADD c int", "mysql")).toBe(true);
    expect(commitsImplicitly("TRUNCATE t", "mysql")).toBe(true);
  });

  it("is false for temporary tables and DML on MySQL", () => {
    expect(commitsImplicitly("CREATE TEMPORARY TABLE t (id int)", "mysql")).toBe(false);
    expect(commitsImplicitly("DROP TEMPORARY TABLE t", "mysql")).toBe(false);
    expect(commitsImplicitly("INSERT INTO t VALUES (1)", "mysql")).toBe(false);
  });

  it("is false on engines with transactional DDL", () => {
    expect(commitsImplicitly("CREATE TABLE t (id int)", "postgres")).toBe(false);
    expect(commitsImplicitly("CREATE TABLE t (id int)", "sqlite")).toBe(false);
  });
});

describe("readsOnly", () => {
  it("is true for plain reads", () => {
    for (const sql of ["SELECT * FROM t", " -- x\n select 1;", "SHOW TABLES", "EXPLAIN SELECT 1", "DESCRIBE t"]) {
      expect(readsOnly(sql)).toBe(true);
    }
  });

  it("is false for writes, locking reads and anything it cannot vouch for", () => {
    for (const sql of [
      "UPDATE t SET a = 1",
      "SELECT * FROM t FOR UPDATE",
      "SELECT * INTO t2 FROM t",
      "SELECT * FROM t LOCK IN SHARE MODE",
      "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
      "CALL p()",
      "",
    ]) {
      expect(readsOnly(sql)).toBe(false);
    }
  });

  it("is not fooled by a keyword inside a string", () => {
    expect(readsOnly("SELECT 'for update' FROM t")).toBe(true);
  });
});

describe("planStatement", () => {
  const open: TxSession = { manual: true, open: true, statements: 2 };

  it("runs as before in auto-commit mode", () => {
    expect(planStatement(idleTx(), "UPDATE t SET a = 1", "sqlite")).toEqual({
      kind: "run", beginFirst: false, opens: false, implicitCommit: false,
    });
  });

  it("begins first in manual mode, only when nothing is open", () => {
    expect(planStatement(idleTx(true), "UPDATE t SET a = 1", "sqlite")).toMatchObject({ beginFirst: true });
    expect(planStatement(open, "UPDATE t SET a = 1", "sqlite")).toMatchObject({ beginFirst: false });
  });

  it("does not open a transaction for a plain read", () => {
    expect(planStatement(idleTx(true), "SELECT * FROM t", "sqlite")).toMatchObject({ beginFirst: false });
    expect(planStatement(idleTx(true), "SELECT * FROM t FOR UPDATE", "postgres")).toMatchObject({ beginFirst: true });
  });

  it("routes bare transaction statements to tx.*", () => {
    expect(planStatement(idleTx(), "BEGIN", "sqlite")).toEqual({ kind: "tx", verb: "begin" });
    expect(planStatement(open, "COMMIT", "sqlite")).toEqual({ kind: "tx", verb: "commit" });
    expect(planStatement(open, "ROLLBACK", "sqlite")).toEqual({ kind: "tx", verb: "rollback" });
  });

  it("refuses a begin while a transaction is open", () => {
    expect(planStatement(open, "BEGIN", "sqlite")).toEqual({ kind: "refuse" });
    expect(planStatement(open, "START TRANSACTION READ ONLY", "mysql")).toEqual({ kind: "refuse" });
  });

  it("runs a begin with options as typed", () => {
    expect(planStatement(idleTx(true), "BEGIN IMMEDIATE", "sqlite")).toEqual({
      kind: "run", beginFirst: false, opens: true, implicitCommit: false,
    });
  });

  it("never begins for MySQL DDL, and flags the implicit commit of an open one", () => {
    expect(planStatement(idleTx(true), "CREATE TABLE t (a int)", "mysql")).toEqual({
      kind: "run", beginFirst: false, opens: false, implicitCommit: false,
    });
    expect(planStatement(open, "CREATE TABLE t (a int)", "mysql")).toMatchObject({ implicitCommit: true });
  });
});

/** Effects over an in-memory session that log every call and fail where told. */
function effects(start: TxSession, fail: { query?: boolean; tx?: TxVerb } = {}) {
  const log: string[] = [];
  let state = start;
  let implicit = 0;
  const fx = {
    get: () => state,
    set: (s: TxSession) => {
      state = s;
    },
    query: async () => {
      log.push("query");
      if (fail.query) throw new Error("syntax error");
      return "rows";
    },
    tx: async (verb: TxVerb) => {
      log.push(verb);
      if (fail.tx === verb) throw new Error(`${verb} failed`);
    },
    empty: () => "empty",
    onImplicitCommit: () => {
      implicit++;
    },
  };
  return { fx, log, state: () => state, implicit: () => implicit };
}

describe("runInTx", () => {
  it("manual: a read runs outside any transaction and is not counted", async () => {
    const e = effects(idleTx(true));
    await runInTx("SELECT 1", "sqlite", e.fx);
    expect(e.log).toEqual(["query"]);
    expect(e.state()).toEqual(idleTx(true));
  });

  it("auto-commit: just runs the query", async () => {
    const e = effects(idleTx());
    expect(await runInTx("SELECT 1", "sqlite", e.fx)).toBe("rows");
    expect(e.log).toEqual(["query"]);
    expect(e.state()).toEqual(idleTx());
  });

  it("manual: begins before the first statement and counts what runs inside", async () => {
    const e = effects(idleTx(true));
    await runInTx("UPDATE t SET a = 1", "sqlite", e.fx);
    await runInTx("UPDATE t SET a = 2", "sqlite", e.fx);
    expect(e.log).toEqual(["begin", "query", "query"]);
    expect(e.state()).toEqual({ manual: true, open: true, statements: 2 });
  });

  it("counts a statement that failed inside the transaction, which stays open", async () => {
    const e = effects(idleTx(true), { query: true });
    await expect(runInTx("UPDATE x", "sqlite", e.fx)).rejects.toThrow("syntax error");
    expect(e.state()).toEqual({ manual: true, open: true, statements: 1 });
  });

  it("does not run the statement when the begin fails", async () => {
    const e = effects(idleTx(true), { tx: "begin" });
    await expect(runInTx("UPDATE t SET a = 1", "mongodb", e.fx)).rejects.toThrow("begin failed");
    expect(e.log).toEqual(["begin"]);
    expect(e.state()).toEqual(idleTx(true));
  });

  it("a typed COMMIT runs tx.commit and ends the transaction", async () => {
    const e = effects({ manual: true, open: true, statements: 3 });
    expect(await runInTx("commit;", "sqlite", e.fx)).toBe("empty");
    expect(e.log).toEqual(["commit"]);
    expect(e.state()).toEqual(idleTx(true));
  });

  it("a failed commit leaves the transaction open; a failed rollback ends it", async () => {
    const c = effects({ manual: true, open: true, statements: 3 }, { tx: "commit" });
    await expect(runInTx("COMMIT", "sqlite", c.fx)).rejects.toThrow();
    expect(c.state()).toEqual({ manual: true, open: true, statements: 3 });
    const r = effects({ manual: true, open: true, statements: 3 }, { tx: "rollback" });
    await expect(runInTx("ROLLBACK", "sqlite", r.fx)).rejects.toThrow();
    expect(r.state()).toEqual(idleTx(true));
  });

  it("a typed BEGIN in auto-commit opens a transaction the indicator shows", async () => {
    const e = effects(idleTx());
    await runInTx("BEGIN", "sqlite", e.fx);
    await runInTx("DELETE FROM t", "sqlite", e.fx);
    expect(e.log).toEqual(["begin", "query"]);
    expect(e.state()).toEqual({ manual: false, open: true, statements: 1 });
  });

  it("refuses a second BEGIN without sending anything", async () => {
    const e = effects({ manual: true, open: true, statements: 1 });
    await expect(runInTx("BEGIN", "sqlite", e.fx)).rejects.toBeInstanceOf(TxAlreadyOpenError);
    expect(e.log).toEqual([]);
  });

  it("a begin with options runs as typed and opens only once it succeeded", async () => {
    const ok = effects(idleTx());
    await runInTx("BEGIN IMMEDIATE", "sqlite", ok.fx);
    expect(ok.log).toEqual(["query"]);
    expect(ok.state()).toEqual({ manual: false, open: true, statements: 0 });
    const bad = effects(idleTx(), { query: true });
    await expect(runInTx("BEGIN IMMEDIATE", "sqlite", bad.fx)).rejects.toThrow();
    expect(bad.state()).toEqual(idleTx());
  });

  it("MySQL DDL inside a transaction: reported as committed, core bookkeeping ended", async () => {
    const e = effects({ manual: true, open: true, statements: 2 });
    await runInTx("CREATE TABLE t (a int)", "mysql", e.fx);
    expect(e.log).toEqual(["query", "commit"]);
    expect(e.state()).toEqual(idleTx(true));
    expect(e.implicit()).toBe(1);
  });

  it("MySQL DDL that fails still committed the transaction", async () => {
    const e = effects({ manual: true, open: true, statements: 2 }, { query: true });
    await expect(runInTx("ALTER TABLE nope ADD c int", "mysql", e.fx)).rejects.toThrow();
    expect(e.state()).toEqual(idleTx(true));
    expect(e.implicit()).toBe(1);
  });
});
