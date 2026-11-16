import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SalesActor } from "@/lib/sales/access";

// The Bots page gates itself: no Sales access means the Sales 404, a Sales
// user who is not an admin also gets a 404 and reads nothing, an admin gets
// the screen loaded through the one server module. No loading.tsx (a real 404).

const requireSalesPage = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("next:not-found");
});
const loadBotsScreen = vi.fn();

vi.mock("@/lib/sales/page-gate", () => ({ requireSalesPage: () => requireSalesPage() }));
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("@/lib/sales/bots-screen", () => ({ loadBotsScreen: () => loadBotsScreen() }));
vi.mock("@/components/sales/bots-view", () => ({ BotsView: () => null }));

const { default: BotsPage } = await import("@/app/(app)/sales/settings/bots/page");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };

beforeEach(() => {
  requireSalesPage.mockReset();
  loadBotsScreen.mockReset().mockResolvedValue({ bots: [] });
});

describe("Bots page", () => {
  it("reads nothing for someone without Sales access", async () => {
    requireSalesPage.mockRejectedValue(new Error("next:not-found"));
    await expect(BotsPage()).rejects.toThrow("next:not-found");
    expect(loadBotsScreen).not.toHaveBeenCalled();
  });

  it("gives a 404 to a Sales user who is not an admin, and reads nothing", async () => {
    requireSalesPage.mockResolvedValue(rep);
    await expect(BotsPage()).rejects.toThrow("next:not-found");
    expect(loadBotsScreen).not.toHaveBeenCalled();
  });

  it("loads the screen for an admin", async () => {
    requireSalesPage.mockResolvedValue(admin);
    await BotsPage();
    expect(loadBotsScreen).toHaveBeenCalledTimes(1);
  });

  it("has no loading.tsx, so a non-admin gets a real 404", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/app/(app)/sales/settings/bots/loading.tsx"))).toBe(false);
  });
});
