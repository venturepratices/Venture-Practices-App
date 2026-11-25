import { beforeEach, describe, expect, it, vi } from "vitest";

import { logMarketingAction, logMarketingView } from "@/lib/marketing/audit";

// Dedupe + silent-failure contract for the Marketing audit helper. Views are
// deduped per (actor, surface) within a 5-minute window; actions are never
// deduped. A logging failure must NEVER throw.

const createMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityLog: {
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue({ id: "row-1" });
  vi.resetModules();
});

describe("logMarketingView", () => {
  it("writes an ActivityLog row with the Marketing entity type and action", async () => {
    const { logMarketingView: freshView } = await import("@/lib/marketing/audit");
    await freshView(
      { userId: "user-1", name: "Ann" },
      "marketing.stats.view",
      { window: "30d" },
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    const row = createMock.mock.calls[0]?.[0]?.data;
    expect(row).toMatchObject({
      actorId: "user-1",
      actorName: "Ann",
      entityType: "marketing",
      entityId: "marketing.stats.view",
      action: "marketing.stats.view",
    });
    expect(row.details).toEqual({ window: "30d" });
  });

  it("dedupes repeat views by the same actor on the same surface", async () => {
    const { logMarketingView: freshView } = await import("@/lib/marketing/audit");
    await freshView({ userId: "user-1" }, "marketing.sync.view");
    await freshView({ userId: "user-1" }, "marketing.sync.view");
    await freshView({ userId: "user-1" }, "marketing.sync.view");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("does not dedupe across different actors", async () => {
    const { logMarketingView: freshView } = await import("@/lib/marketing/audit");
    await freshView({ userId: "user-1" }, "marketing.sync.view");
    await freshView({ userId: "user-2" }, "marketing.sync.view");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("does not dedupe across different surfaces", async () => {
    const { logMarketingView: freshView } = await import("@/lib/marketing/audit");
    await freshView({ userId: "user-1" }, "marketing.sync.view");
    await freshView({ userId: "user-1" }, "marketing.stats.view");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("never throws when the underlying write fails", async () => {
    createMock.mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { logMarketingView: freshView } = await import("@/lib/marketing/audit");
      await expect(
        freshView({ userId: "user-1" }, "marketing.followup.view"),
      ).resolves.toBeUndefined();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("logMarketingAction", () => {
  it("always writes a row, with no dedupe", async () => {
    const { logMarketingAction: freshAction } = await import(
      "@/lib/marketing/audit"
    );
    await freshAction({ userId: "user-1" }, "marketing.flow.update", "updated flow", {
      flowId: "abc",
    });
    await freshAction({ userId: "user-1" }, "marketing.flow.update", "updated flow", {
      flowId: "abc",
    });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("never throws when the underlying write fails", async () => {
    createMock.mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { logMarketingAction: freshAction } = await import(
        "@/lib/marketing/audit"
      );
      await expect(
        freshAction({ userId: "user-1" }, "marketing.flow.update", "updated flow"),
      ).resolves.toBeUndefined();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
