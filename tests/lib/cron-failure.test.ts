import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// reportCronFailure is the one line every cron route's catch block calls so a
// failed job reaches Sentry instead of only showing as a red line in Vercel's
// cron log. Two things matter: the event must actually be sent before the
// serverless function ends (hence the flush), and the helper must never make
// a bad situation worse by throwing from inside a catch block.

const calls: string[] = [];
const captureException = vi.hoisted(() => vi.fn());
const flush = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  flush: (...args: unknown[]) => flush(...args),
}));

const { reportCronFailure } = await import("@/lib/cron-failure");

describe("reportCronFailure", () => {
  beforeEach(() => {
    calls.length = 0;
    captureException.mockImplementation(() => {
      calls.push("capture");
      return "event-id";
    });
    flush.mockImplementation(async () => {
      calls.push("flush");
      return true;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    captureException.mockReset();
    flush.mockReset();
    vi.restoreAllMocks();
  });

  it("sends the error to Sentry tagged with the job name at level error", async () => {
    const error = new Error("database unreachable");
    await reportCronFailure("backup", error);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, { tags: { cron: "backup" }, level: "error" });
  });

  it("waits up to 2 seconds for the event to be sent, after capturing it", async () => {
    await reportCronFailure("storage-check", new Error("boom"));

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(2000);
    expect(calls).toEqual(["capture", "flush"]);
  });

  it("does not return until the flush has finished", async () => {
    let flushFinished = false;
    flush.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      flushFinished = true;
      return true;
    });

    await reportCronFailure("calendar-sync", new Error("boom"));

    expect(flushFinished).toBe(true);
  });

  it("reports a thrown value that is not an Error as it was given", async () => {
    await reportCronFailure("highlevel-prune", "plain string failure");

    expect(captureException).toHaveBeenCalledWith("plain string failure", {
      tags: { cron: "highlevel-prune" },
      level: "error",
    });
  });

  it("never throws when Sentry throws while capturing", async () => {
    captureException.mockImplementation(() => {
      throw new Error("sentry is down");
    });

    await expect(reportCronFailure("backup", new Error("original failure"))).resolves.toBeUndefined();
  });

  it("never throws when the flush rejects", async () => {
    flush.mockRejectedValue(new Error("flush failed"));

    await expect(reportCronFailure("backup", new Error("original failure"))).resolves.toBeUndefined();
  });

  it("never throws when the flush throws before returning a promise", async () => {
    flush.mockImplementation(() => {
      throw new Error("flush exploded");
    });

    await expect(reportCronFailure("backup", new Error("original failure"))).resolves.toBeUndefined();
  });
});
