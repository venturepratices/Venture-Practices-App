import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SalesActor } from "@/lib/sales/access";
import type { LeadAssignmentView, StageSettings } from "@/lib/sales/settings";

// The Sales settings page gates itself (layouts do not re-run on navigation),
// is admins-only (`notFound()` for everyone else, no `loading.tsx`), and reads
// its two loaders in one Promise.all.

const requireSalesPage = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("next:not-found");
});
const loadLeadAssignmentView = vi.fn();
const loadStageSettings = vi.fn();

vi.mock("@/lib/sales/page-gate", () => ({ requireSalesPage: () => requireSalesPage() }));
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("@/lib/sales/settings", () => ({
  loadLeadAssignmentView: (...args: unknown[]) => loadLeadAssignmentView(...args),
  loadStageSettings: (...args: unknown[]) => loadStageSettings(...args),
}));
vi.mock("@/components/sales/settings-view", () => ({ SettingsView: () => null }));

const { default: SettingsPage } = await import("@/app/(app)/sales/settings/page");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };

beforeEach(() => {
  requireSalesPage.mockReset();
  notFound.mockReset().mockImplementation(() => {
    throw new Error("next:not-found");
  });
  loadLeadAssignmentView.mockReset();
  loadStageSettings.mockReset();
});

describe("Sales settings page", () => {
  it("reads nothing for someone without Sales access", async () => {
    requireSalesPage.mockRejectedValue(new Error("next:not-found"));
    await expect(SettingsPage()).rejects.toThrow("next:not-found");
    expect(loadLeadAssignmentView).not.toHaveBeenCalled();
    expect(loadStageSettings).not.toHaveBeenCalled();
  });

  it("gives a 404 to a Sales user who is not an admin, and reads nothing", async () => {
    requireSalesPage.mockResolvedValue(rep);
    await expect(SettingsPage()).rejects.toThrow("next:not-found");
    expect(notFound).toHaveBeenCalled();
    expect(loadLeadAssignmentView).not.toHaveBeenCalled();
    expect(loadStageSettings).not.toHaveBeenCalled();
  });

  it("loads the assignment view and the stage settings for an admin", async () => {
    requireSalesPage.mockResolvedValue(admin);
    const assignment: LeadAssignmentView = {
      mode: "ROUND_ROBIN",
      members: [{ id: "b", name: "Ben Example" }],
      rotation: [],
      single: null,
      effective: { mode: "ROUND_ROBIN", names: ["Ben S."], fallbackName: null },
      firstAdminName: "Ben E.",
    };
    const pipelines: StageSettings[] = [
      { id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES", stages: [] },
    ];
    loadLeadAssignmentView.mockResolvedValue(assignment);
    loadStageSettings.mockResolvedValue(pipelines);

    const element = await SettingsPage();

    expect(loadLeadAssignmentView).toHaveBeenCalledTimes(1);
    expect(loadStageSettings).toHaveBeenCalledTimes(1);
    expect(element.props).toEqual({ assignment, pipelines });
  });

  it("has no loading.tsx (Decision 28: notFound() must be a real 404)", () => {
    const dir = path.join(process.cwd(), "src", "app", "(app)", "sales", "settings");
    expect(fs.existsSync(path.join(dir, "loading.tsx"))).toBe(false);
  });
});
