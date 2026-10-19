import { describe, it, expect } from "vitest";
import { runStatements, type StepStatus } from "../../src/utils/statementRun";

function recorder() {
  const log: [number, StepStatus["state"]][] = [];
  return { log, onStatus: (i: number, s: StepStatus) => log.push([i, s.state]) };
}

describe("runStatements", () => {
  it("runs each statement in order and times it", async () => {
    const ran: string[] = [];
    const { log, onStatus } = recorder();
    let clock = 0;
    const statuses: StepStatus[] = [];
    const out = await runStatements(
      ["A", "B"],
      async (sql) => {
        ran.push(sql);
        clock += 5;
      },
      (i, s) => {
        onStatus(i, s);
        statuses.push(s);
      },
      { now: () => clock },
    );
    expect(ran).toEqual(["A", "B"]);
    expect(out).toEqual({ done: 2, failedAt: null, cancelled: false });
    expect(log).toEqual([[0, "running"], [0, "done"], [1, "running"], [1, "done"]]);
    expect(statuses[1]).toEqual({ state: "done", ms: 5 });
  });

  it("skips excluded statements and says so", async () => {
    const ran: string[] = [];
    const { log, onStatus } = recorder();
    const out = await runStatements(["A", "DROP", "B"], async (s) => void ran.push(s), onStatus, {
      excluded: new Set([1]),
    });
    expect(ran).toEqual(["A", "B"]);
    expect(out.done).toBe(2);
    expect(log).toContainEqual([1, "excluded"]);
  });

  it("stops at the first failure and marks the rest as not run", async () => {
    const statuses: [number, StepStatus][] = [];
    const out = await runStatements(
      ["A", "B", "C", "D"],
      async (s) => {
        if (s === "B") throw new Error("no such table");
      },
      (i, s) => statuses.push([i, s]),
      { excluded: new Set([3]) },
    );
    expect(out).toEqual({ done: 1, failedAt: 1, cancelled: false });
    expect(statuses).toContainEqual([1, { state: "failed", message: "no such table" }]);
    expect(statuses).toContainEqual([2, { state: "notRun" }]);
    // The excluded one keeps its own reason, not «notRun».
    expect(statuses.filter(([i]) => i === 3)).toEqual([]);
  });

  it("stops between statements when cancelled", async () => {
    const ctl = new AbortController();
    const ran: string[] = [];
    const { log, onStatus } = recorder();
    const out = await runStatements(
      ["A", "B", "C"],
      async (s) => {
        ran.push(s);
        ctl.abort();
      },
      onStatus,
      { signal: ctl.signal },
    );
    expect(ran).toEqual(["A"]);
    expect(out).toEqual({ done: 1, failedAt: null, cancelled: true });
    expect(log.slice(-2)).toEqual([[1, "notRun"], [2, "notRun"]]);
  });

  it("does nothing for an empty list", async () => {
    expect(await runStatements([], async () => {}, () => {})).toEqual({ done: 0, failedAt: null, cancelled: false });
  });
});
