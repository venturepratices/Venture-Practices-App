import { describe, expect, it } from "vitest";

import { driveRun, STALL_MESSAGE, type ContinueAnswer, type ContinueResult } from "@/lib/sales/pipedrive/import-view-model";

// The loop that carries a copy forward from the browser, with a fake clock,
// a fake sleep and a scripted list of answers from the continue route.

type Step = ContinueResult | { ok: true; data: ContinueAnswer; takesMs: number };

function harness(steps: Step[], opts: { activeFor?: number } = {}) {
  let clock = 0;
  let calls = 0;
  const sleeps: number[] = [];
  const progress: { phase: string; paused: boolean }[] = [];
  const run = driveRun({
    continueFn: async () => {
      const step = steps[Math.min(calls, steps.length - 1)];
      calls += 1;
      // A chunk that does work takes 45 seconds unless the step says otherwise.
      clock += "takesMs" in step ? step.takesMs : 45_000;
      return "takesMs" in step ? { ok: true, data: step.data } : step;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    isActive: () => opts.activeFor === undefined || calls < opts.activeFor,
    onProgress: (p) => progress.push({ phase: p.phase, paused: p.paused }),
  });
  return { run, sleeps, progress, calls: () => calls };
}

const answer = (phase: string, extra: Partial<ContinueAnswer> = {}): ContinueResult => ({
  ok: true,
  data: { done: false, paused: false, phase, counts: {}, ...extra },
});
const fast = (phase: string, extra: Partial<ContinueAnswer> = {}): Step => ({
  ok: true,
  data: { done: false, paused: false, phase, counts: {}, ...extra },
  takesMs: 300,
});

describe("driveRun", () => {
  it("carries on until the server says done, without waiting between full chunks", async () => {
    const h = harness([answer("deals"), answer("notes"), answer("done", { done: true })]);
    expect(await h.run).toEqual({ kind: "done" });
    expect(h.calls()).toBe(3);
    expect(h.sleeps).toEqual([]);
    expect(h.progress.map((p) => p.phase)).toEqual(["deals", "notes", "done"]);
  });

  it("waits a minute when paused, clears the pause before calling again, then finishes", async () => {
    const h = harness([answer("activities", { paused: true }), answer("done", { done: true })]);
    expect(await h.run).toEqual({ kind: "done" });
    expect(h.sleeps).toEqual([60_000]);
    expect(h.progress).toEqual([
      { phase: "activities", paused: true },
      { phase: "activities", paused: false },
      { phase: "done", paused: false },
    ]);
  });

  it("waits 5 seconds after a quick answer that is not done", async () => {
    const h = harness([fast("deals"), answer("done", { done: true })]);
    expect(await h.run).toEqual({ kind: "done" });
    expect(h.sleeps).toEqual([5_000]);
  });

  it("stops after six quick not-done answers in a row", async () => {
    const h = harness([fast("deals")]);
    expect(await h.run).toEqual({ kind: "stopped", message: STALL_MESSAGE });
    expect(h.calls()).toBe(6);
    expect(STALL_MESSAGE).toBe("This copy may be running in another window. Close other windows, then press Keep going.");
  });

  it("a full chunk between quick answers resets the count", async () => {
    const steps: Step[] = [fast("a"), fast("a"), fast("a"), fast("a"), fast("a"), answer("b"), fast("b"), answer("done", { done: true })];
    const h = harness(steps);
    expect(await h.run).toEqual({ kind: "done" });
  });

  it("stops after ten pauses in a row", async () => {
    const h = harness([answer("notes", { paused: true })]);
    expect(await h.run).toEqual({ kind: "stopped", message: STALL_MESSAGE });
    expect(h.calls()).toBe(10);
  });

  it("stops quietly when the page is no longer active", async () => {
    const h = harness([answer("deals")], { activeFor: 2 });
    expect(await h.run).toEqual({ kind: "inactive" });
    expect(h.calls()).toBe(2);
  });

  it("surfaces an error from the route and stops", async () => {
    const h = harness([answer("deals"), { ok: false, status: 0, error: "Could not reach the server." }]);
    expect(await h.run).toEqual({ kind: "stopped", message: "Could not reach the server." });
  });

  it("stops without a message when the copy ended elsewhere (409)", async () => {
    const h = harness([{ ok: false, status: 409, error: "This copy is not running any more." }]);
    expect(await h.run).toEqual({ kind: "stopped", message: null });
  });
});
