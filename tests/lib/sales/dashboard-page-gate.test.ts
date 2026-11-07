import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SalesActor } from "@/lib/sales/access";

// The Sales dashboard gates itself (layouts do not re-run on navigation)
// before it reads anything, and reads Everyone / Just me from the URL through
// the shared parser.

const requireSalesPage = vi.fn();
const loadDashboard = vi.fn();

vi.mock("@/lib/sales/page-gate", () => ({ requireSalesPage: () => requireSalesPage() }));
vi.mock("@/lib/sales/dashboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/dashboard")>();
  return { parseDashboardScope: actual.parseDashboardScope, loadDashboard: (...args: unknown[]) => loadDashboard(...args) };
});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/components/sales/dashboard-view", () => ({ DashboardView: () => null }));

const { default: DashboardPage } = await import("@/app/(app)/sales/dashboard/page");

const actor: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };

beforeEach(() => {
  requireSalesPage.mockReset();
  loadDashboard.mockReset();
});

describe("Sales dashboard page", () => {
  it("reads nothing for someone without Sales access", async () => {
    requireSalesPage.mockRejectedValue(new Error("next:not-found"));
    await expect(DashboardPage({ searchParams: Promise.resolve({ scope: "mine" }) })).rejects.toThrow("next:not-found");
    expect(loadDashboard).not.toHaveBeenCalled();
  });

  it("loads Just me for the signed-in actor and passes the data and the server's time", async () => {
    requireSalesPage.mockResolvedValue(actor);
    const data = { scope: "mine" };
    loadDashboard.mockResolvedValue(data);

    const element = await DashboardPage({ searchParams: Promise.resolve({ scope: "mine" }) });

    expect(loadDashboard).toHaveBeenCalledWith(actor, "mine", expect.any(Date));
    expect(Object.keys(element.props).sort()).toEqual(["data", "now"]);
    expect(element.props.data).toBe(data);
    expect(new Date(element.props.now).toISOString()).toBe(element.props.now);
    // The time the data was read for is the time the screen is drawn for.
    expect(element.props.now).toBe((loadDashboard.mock.calls[0][2] as Date).toISOString());
  });

  it("reads anything else in the URL as Everyone", async () => {
    requireSalesPage.mockResolvedValue(actor);
    loadDashboard.mockResolvedValue({ scope: "everyone" });

    await DashboardPage({ searchParams: Promise.resolve({ scope: "nobody" }) });

    expect(loadDashboard).toHaveBeenCalledWith(actor, "everyone", expect.any(Date));
  });
});
