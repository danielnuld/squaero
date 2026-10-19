import { describe, it, expect, vi } from "vitest";
import { createSignal } from "solid-js";
import { busyTools, onToolJobFinished, watchToolBusy } from "../../src/utils/toolJobs";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("tool jobs", () => {
  it("marks a tab busy while its panel says so and reports the end", async () => {
    const done = vi.fn();
    onToolJobFinished(done);
    const [busy, setBusy] = createSignal(false);
    const release = watchToolBusy(1, busy);
    expect(busyTools().has(1)).toBe(false);
    setBusy(true);
    await tick();
    expect(busyTools().has(1)).toBe(true);
    setBusy(false);
    await tick();
    expect(busyTools().has(1)).toBe(false);
    expect(done).toHaveBeenCalledWith(1, expect.any(Number));
    release();
  });

  it("keeps a job whose panel was unmounted until it ends", async () => {
    const done = vi.fn();
    onToolJobFinished(done);
    const [busy, setBusy] = createSignal(true);
    const release = watchToolBusy(2, busy);
    await tick();
    release(); // the user switched tabs mid-job
    expect(busyTools().has(2)).toBe(true);
    setBusy(false);
    await tick();
    expect(busyTools().has(2)).toBe(false);
    expect(done).toHaveBeenCalledWith(2, expect.any(Number));
    // Dropped once done: going busy again no longer counts.
    setBusy(true);
    await tick();
    expect(busyTools().has(2)).toBe(false);
  });

  it("lets an idle panel go at once, and a remounted panel take over", async () => {
    onToolJobFinished(() => {});
    const [a, setA] = createSignal(true);
    const releaseA = watchToolBusy(3, a);
    await tick();
    releaseA();
    const [b] = createSignal(false);
    const releaseB = watchToolBusy(3, b);
    setA(false);
    await tick();
    expect(busyTools().has(3)).toBe(false);
    releaseB();
    const [c, setC] = createSignal(false);
    watchToolBusy(4, c)();
    setC(true);
    await tick();
    expect(busyTools().has(4)).toBe(false);
  });
});
