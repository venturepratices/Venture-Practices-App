import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SalesActor } from "@/lib/sales/access";

// The Leads Inbox gates itself (layouts do not re-run on navigation) before it
// reads anything, reads the URL through the shared parser, and opens Add lead
// for `?new=1`.

const requireSalesPage = vi.fn();
const loadLeadsPage = vi.fn();

vi.mock("@/lib/sales/page-gate", () => ({ requireSalesPage: () => requireSalesPage() }));
vi.mock("@/lib/sales/leads-page", () => ({
  loadLeadsPage: (...args: unknown[]) => loadLeadsPage(...args),
}));
vi.mock("@/components/sales/leads-view", () => ({ LeadsView: () => null }));

const { default: LeadsPage } = await import("@/app/(app)/sales/leads/page");

const actor: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };

beforeEach(() => {
  requireSalesPage.mockReset();
  loadLeadsPage.mockReset();
});

describe("Leads Inbox page", () => {
  it("reads nothing for someone without Sales access", async () => {
    requireSalesPage.mockRejectedValue(new Error("next:not-found"));
    await expect(LeadsPage({ searchParams: Promise.resolve({ scope: "mine", new: "1" }) })).rejects.toThrow("next:not-found");
    expect(loadLeadsPage).not.toHaveBeenCalled();
  });

  it("loads Just me for the signed-in actor and opens Add lead", async () => {
    requireSalesPage.mockResolvedValue(actor);
    const data = { rows: [], nextCursor: null };
    loadLeadsPage.mockResolvedValue(data);

    const element = await LeadsPage({ searchParams: Promise.resolve({ scope: "mine", new: "1" }) });

    expect(loadLeadsPage).toHaveBeenCalledWith(actor, { scope: "mine", q: "", cursor: null });
    expect(Object.keys(element.props).sort()).toEqual(["data", "now", "openNew", "viewer"]);
    expect(element.props.data).toBe(data);
    expect(element.props.viewer).toEqual({ userId: "r", isAdmin: false });
    expect(element.props.openNew).toBe(true);
    expect(new Date(element.props.now).toISOString()).toBe(element.props.now);
  });

  it("opens Add lead only for new=1, and passes the search", async () => {
    requireSalesPage.mockResolvedValue({ ...actor, isAdmin: true });
    loadLeadsPage.mockResolvedValue({ rows: [] });

    const plain = await LeadsPage({ searchParams: Promise.resolve({ q: "oak", new: "yes" }) });

    expect(loadLeadsPage).toHaveBeenCalledWith({ ...actor, isAdmin: true }, { scope: "everyone", q: "oak", cursor: null });
    expect(plain.props.openNew).toBe(false);
    expect(plain.props.viewer).toEqual({ userId: "r", isAdmin: true });
  });
});
