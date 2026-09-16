// Applying an edit plan inside the session's transaction (openspec:
// paste-rows-as-inserts, fase A).
//
// The plan runs item by item and commits at the end. What this module adds is
// what happens when an item fails: the transaction is rolled back and a new one
// begun BEFORE control returns. Leaving it open — the old behaviour — kept the
// items that had already run, so the next attempt ran them a second time: an
// insert that had gone through collided with itself, and on PostgreSQL the
// aborted transaction refused everything until it was rolled back.
//
// The effects are injected, so the order of calls is unit-tested without a core.

import type { PlanItem } from "./editSession";

export interface ApplyEffects {
  run: (item: PlanItem) => Promise<unknown>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  begin: () => Promise<void>;
}

export type ApplyOutcome =
  | { ok: true }
  | {
      ok: false;
      error: unknown;
      /** Index into the plan of the item that failed; null when the commit did. */
      failedIndex: number | null;
      /** A fresh transaction is open, so the session can be retried as is. */
      reopened: boolean;
    };

export async function applyPlan(plan: PlanItem[], fx: ApplyEffects): Promise<ApplyOutcome> {
  let failedIndex: number | null = null;
  try {
    for (let i = 0; i < plan.length; i++) {
      failedIndex = i;
      await fx.run(plan[i]);
    }
    failedIndex = null;
    await fx.commit();
    return { ok: true };
  } catch (error) {
    try {
      await fx.rollback();
    } catch {
      /* the begin below says whether the session is still usable */
    }
    let reopened = true;
    try {
      await fx.begin();
    } catch {
      reopened = false;
    }
    return { ok: false, error, failedIndex, reopened };
  }
}
