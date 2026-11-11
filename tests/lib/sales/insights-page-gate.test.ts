import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SalesActor } from "@/lib/sales/access";

// The Insights page gates itself (layouts do not re-run on navigation) before
// it reads anything, and reads range, scope and pipeline from the URL through
// the shared parser.

const requireSalesPage = vi.fn();
const loadInsights = vi.fn();

vi.mock("@/lib/sales/page-gate", () => ({ requireSalesPage: () => requireSalesPage() }));
vi.mock("@/lib/sales/insights", () => ({
  loadInsights: (...args: unknown[]) => loadInsights(...args),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/components/sales/insights-view", () => ({ InsightsView: () => null }));

const { default: InsightsPage } = await import("@/app/(app)/sales/insights/page");

const actor: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };

beforeEach(() => {
  requireSalesPage.mockReset();
  loadInsights.mockReset();
});

describe("Sales Insights page", () => {
  it("reads nothing for someone without Sales access", async () => {
    requireSalesPage.mockRejectedValue(new Error("next:not-found"));
    await expect(InsightsPage({ searchParams: Promise.resolve({ range: "6" }) })).rejects.toThrow("next:not-found");
    expect(loadInsights).not.toHaveBeenCalled();
  });

  it("loads the parsed query and passes the server's time to the view", async () => {
    requireSalesPage.mockResolvedValue(actor);
    const data = { query: { range: 6, scope: "mine", pipeline: "direct-mail" } };
    loadInsights.mockResolvedValue(data);

    const element = await InsightsPage({
      searchParams: Promise.resolve({ range: "6", scope: "mine", pipeline: "direct-mail" }),
    });

    expect(loadInsights).toHaveBeenCalledWith(
      actor,
      { range: 6, scope: "mine", pipeline: "direct-mail" },
      expect.any(Date),
    );
    expect(Object.keys(element.props).sort()).toEqual(["data", "now"]);
    expect(element.props.data).toBe(data);
    expect(new Date(element.props.now).toISOString()).toBe(element.props.now);
    // The time the data was read for is the time the screen is drawn for.
    expect(element.props.now).toBe((loadInsights.mock.calls[0][2] as Date).toISOString());
  });

  it("reads defaults when the URL has nothing or junk", async () => {
    requireSalesPage.mockResolvedValue(actor);
    loadInsights.mockResolvedValue({});

    await InsightsPage({ searchParams: Promise.resolve({ range: "99", scope: "nobody" }) });

    expect(loadInsights).toHaveBeenCalledWith(actor, { range: 3, scope: "everyone", pipeline: null }, expect.any(Date));
  });
});
