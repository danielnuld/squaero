// Applying an edit plan in its own short transaction (openspec:
// paste-rows-as-inserts, fase A).
//
// The transaction lives only as long as the apply: begin, run the plan item by
// item, commit. Editing itself holds none. A transaction opened when editing
// started and kept while the user typed froze every read on the connection
// (MySQL/InnoDB's REPEATABLE READ snapshot): refreshes, the filter panel and
// other tabs on the same connection kept showing the old rows, and closing the
// tab left it open until a reconnect.
//
// When an item fails the transaction is rolled back before control returns, so
// nothing that ran is kept and a retry runs each item exactly once.
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
      /** Index into the plan of the item that failed; null when the begin or
          the commit did. */
      failedIndex: number | null;
    };

export async function applyPlan(plan: PlanItem[], fx: ApplyEffects): Promise<ApplyOutcome> {
  try {
    await fx.begin();
  } catch (error) {
    return { ok: false, error, failedIndex: null };
  }
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
      /* best effort: the error reported is the item's */
    }
    return { ok: false, error, failedIndex };
  }
}
