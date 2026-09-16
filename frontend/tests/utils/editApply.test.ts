import { describe, it, expect } from "vitest";
import { applyPlan, type ApplyEffects } from "../../src/utils/editApply";
import type { PlanItem } from "../../src/utils/editSession";

const insert = (id: string): PlanItem => ({ kind: "insert", values: { id } });

/** Effects that log every call and fail where told to. */
function effects(fail: { run?: number; commit?: boolean; rollback?: boolean; begin?: boolean } = {}) {
  const log: string[] = [];
  let runs = 0;
  const fx: ApplyEffects = {
    run: async (item) => {
      const n = runs++;
      log.push(`run:${item.kind === "insert" ? item.values.id : item.kind}`);
      if (fail.run === n) throw new Error("duplicate key");
    },
    commit: async () => {
      log.push("commit");
      if (fail.commit) throw new Error("commit failed");
    },
    rollback: async () => {
      log.push("rollback");
      if (fail.rollback) throw new Error("rollback failed");
    },
    begin: async () => {
      log.push("begin");
      if (fail.begin) throw new Error("connection lost");
    },
  };
  return { fx, log };
}

describe("applyPlan", () => {
  it("runs every item in order and commits", async () => {
    const { fx, log } = effects();
    expect(await applyPlan([insert("1"), insert("2")], fx)).toEqual({ ok: true });
    expect(log).toEqual(["run:1", "run:2", "commit"]);
  });

  it("commits an empty plan", async () => {
    const { fx, log } = effects();
    expect(await applyPlan([], fx)).toEqual({ ok: true });
    expect(log).toEqual(["commit"]);
  });

  it("stops at a failing item, rolls back and opens a new transaction", async () => {
    const { fx, log } = effects({ run: 1 });
    const outcome = await applyPlan([insert("1"), insert("2"), insert("3")], fx);
    expect(outcome).toMatchObject({ ok: false, failedIndex: 1, reopened: true });
    expect((outcome as { error: Error }).error.message).toBe("duplicate key");
    // The third item never ran and nothing was committed.
    expect(log).toEqual(["run:1", "run:2", "rollback", "begin"]);
  });

  it("a retry after a failure runs each item exactly once more", async () => {
    const first = effects({ run: 1 });
    await applyPlan([insert("1"), insert("2")], first.fx);
    const retry = effects();
    expect(await applyPlan([insert("1"), insert("2")], retry.fx)).toEqual({ ok: true });
    expect(retry.log).toEqual(["run:1", "run:2", "commit"]);
  });

  it("reports a failed commit without blaming an item", async () => {
    const { fx, log } = effects({ commit: true });
    const outcome = await applyPlan([insert("1")], fx);
    expect(outcome).toMatchObject({ ok: false, failedIndex: null, reopened: true });
    expect(log).toEqual(["run:1", "commit", "rollback", "begin"]);
  });

  it("still opens a new transaction when the rollback itself fails", async () => {
    const { fx, log } = effects({ run: 0, rollback: true });
    const outcome = await applyPlan([insert("1")], fx);
    expect(outcome).toMatchObject({ ok: false, failedIndex: 0, reopened: true });
    expect(log).toEqual(["run:1", "rollback", "begin"]);
  });

  it("says so when no new transaction can be opened", async () => {
    const { fx } = effects({ run: 0, begin: true });
    const outcome = await applyPlan([insert("1")], fx);
    expect(outcome).toMatchObject({ ok: false, failedIndex: 0, reopened: false });
    // The error reported is the item's, not the begin's.
    expect((outcome as { error: Error }).error.message).toBe("duplicate key");
  });
});
