import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SalesActor } from "@/lib/sales/access";

// The Activities page gates itself (layouts do not re-run on navigation) before
// it reads anything, and reads the URL through the shared parser.

const requireSalesPage = vi.fn();
const loadActivitiesPage = vi.fn();

vi.mock("@/lib/sales/page-gate", () => ({ requireSalesPage: () => requireSalesPage() }));
vi.mock("@/lib/sales/activities-page", () => ({
  loadActivitiesPage: (...args: unknown[]) => loadActivitiesPage(...args),
}));
vi.mock("@/components/sales/activities-view", () => ({ ActivitiesView: () => null }));

const { default: ActivitiesPage } = await import("@/app/(app)/sales/activities/page");

const actor: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };

beforeEach(() => {
  requireSalesPage.mockReset();
  loadActivitiesPage.mockReset();
});

describe("Activities page", () => {
  it("reads nothing for someone without Sales access", async () => {
    requireSalesPage.mockRejectedValue(new Error("next:not-found"));
    await expect(ActivitiesPage({ searchParams: Promise.resolve({ when: "today" }) })).rejects.toThrow("next:not-found");
    expect(loadActivitiesPage).not.toHaveBeenCalled();
  });

  it("loads the parsed query for the signed-in actor and passes who is looking", async () => {
    requireSalesPage.mockResolvedValue(actor);
    const data = { rows: [], nextCursor: null };
    loadActivitiesPage.mockResolvedValue(data);

    const element = await ActivitiesPage({ searchParams: Promise.resolve({ when: "today", type: "PARTY", scope: "mine" }) });

    expect(loadActivitiesPage).toHaveBeenCalledWith(
      actor,
      { when: "today", type: "all", scope: "mine", cursor: null },
      expect.any(Date),
    );
    expect(element.props).toMatchObject({ data, viewer: { userId: "r", isAdmin: false } });
    expect(Number.isNaN(Date.parse(element.props.now))).toBe(false);
  });
});
