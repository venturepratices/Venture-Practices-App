import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LeadAssignmentView, StageSettings } from "@/lib/sales/settings";

// A server render of Sales settings (Mockup v2 `viewSettings`). Node has no
// browser, so this cannot click anything; it proves the header, cards and save
// bar render without throwing and carry the words, labels and radios the plan
// asks for. Dialogs are portals, which a server render leaves out, so they
// render in place here.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/settings",
  useSearchParams: () => new URLSearchParams(""),
}));

type Slot = { className?: string; children?: ReactNode; role?: string };

vi.mock("@/components/ui/dialog", async () => {
  const { createElement: h, Fragment: F } = await import("react");
  const part =
    (slot: string) =>
    ({ className, children, role }: Slot) =>
      h("div", { "data-slot": slot, className, role }, children);
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? h(F, null, children) : null),
    DialogContent: part("dialog-content"),
    DialogHeader: part("dialog-header"),
    DialogTitle: part("dialog-title"),
    DialogDescription: part("dialog-description"),
    DialogFooter: part("dialog-footer"),
  };
});

const { SettingsView } = await import("@/components/sales/settings-view");

const MEMBERS = [
  { id: "b", name: "Ben Example" },
  { id: "r", name: "Robert O." },
  { id: "d", name: "DJ" },
];

const PIPELINE_SALES: StageSettings = {
  id: "p1",
  key: "direct-mail",
  name: "Direct Mail",
  kind: "SALES",
  stages: Array.from({ length: 9 }, (_, i) => ({
    id: `s${i + 1}`,
    name: `Stage ${i + 1}`,
    probability: 10,
    isWon: false,
    isLost: false,
    rottingDays: 14,
  })),
};

const PIPELINE_CONSULTING: StageSettings = {
  id: "p2",
  key: "mas",
  name: "Marketing Agency Services",
  kind: "CONSULTING",
  stages: Array.from({ length: 6 }, (_, i) => ({
    id: `cs${i + 1}`,
    name: `Stage ${i + 1}`,
    probability: 10,
    isWon: false,
    isLost: false,
    rottingDays: 14,
  })),
};

const PIPELINES: StageSettings[] = [PIPELINE_SALES, PIPELINE_CONSULTING];

const ASSIGNMENT_OK: LeadAssignmentView = {
  mode: "ROUND_ROBIN",
  members: MEMBERS,
  rotation: [
    { id: "b", name: "Ben Example", hasAccess: true },
    { id: "x", name: "Dana Q.", hasAccess: false },
  ],
  single: null,
  effective: { mode: "ROUND_ROBIN", names: ["Ben S."], fallbackName: null },
  firstAdminName: "Ben E.",
};

const ASSIGNMENT_SINGLE_LOST: LeadAssignmentView = {
  mode: "SINGLE",
  // A saved single person who lost Sales access is no longer in members.
  members: MEMBERS.filter((member) => member.id !== "b"),
  rotation: [],
  single: { id: "b", name: "Ben Example", hasAccess: false },
  effective: { mode: "ROUND_ROBIN", names: ["Robert O."], fallbackName: null },
  firstAdminName: "Robert O.",
};

const clean = (html: string) => html.replaceAll("<!-- -->", "");

function renderView(assignment: LeadAssignmentView, pipelines = PIPELINES): string {
  return clean(renderToString(createElement(SettingsView, { assignment, pipelines })));
}

describe("SettingsView (server render)", () => {
  it("has the pinned header and sub", () => {
    const html = renderView(ASSIGNMENT_OK);
    expect(html).toContain("Sales settings");
    expect(html).toContain("Admins only.");
  });

  it("names the Who gets new leads card with both radios and every Sales member as a checkbox", () => {
    const html = renderView(ASSIGNMENT_OK);
    expect(html).toContain("Who gets new leads");
    expect(html).toContain("Take turns (round-robin) between:");
    expect(html).toContain("Always give them to:");
    // One checkbox per Sales member (short name).
    expect(html).toContain("Ben E.");
    expect(html).toContain("Robert O.");
    expect(html).toContain("DJ");
    // Someone who lost access: the pill and the input is disabled.
    expect(html).toContain("No Sales access");
    expect(html).toContain("Dana Q.");
    // The disabled checkbox carries Dana Q. as its label.
    expect(html).toMatch(/disabled="?" aria-label="Dana Q\."/);
  });

  it("names the skipped people and disables Save and Cancel while nothing has changed", () => {
    const html = renderView(ASSIGNMENT_OK);
    expect(html).toContain("Dana Q. no longer has Sales access");
    expect(html).toContain("Save");
    expect(html).toContain("Cancel");
    // Save and Cancel sit in the save bar; both are disabled while there are no edits.
    const saveButton = /<button[^>]*disabled[^>]*>Save<\/button>/.exec(html);
    expect(saveButton).not.toBeNull();
    const cancelButton = /<button[^>]*disabled[^>]*>Cancel<\/button>/.exec(html);
    expect(cancelButton).not.toBeNull();
  });

  it("names the Rules (always on) card with every pinned line", () => {
    const html = renderView(ASSIGNMENT_OK);
    expect(html).toContain("Rules (always on)");
    expect(html).toContain("Every open deal and lead needs a next activity.");
    expect(html).toContain("A deal cannot go to Proposal Sent with a $0 value.");
    expect(html).toContain("At Proposal Sent, both total value and monthly value are required.");
    expect(html).toContain("Every deal and lead has an owner.");
    expect(html).toContain("A territory hold check is added 7 days before the hold ends.");
    expect(html).toContain("Moving a deal to No Show adds a reschedule call for today.");
    expect(html).toContain("The history log cannot be edited or deleted, by anyone.");
    expect(html).toContain("Files are for final versions only (signed contracts, final proposals).");
  });

  it("names Pipelines and stages with each kind, stage count and aria-label", () => {
    const html = renderView(ASSIGNMENT_OK);
    expect(html).toContain("Pipelines and stages");
    expect(html).toContain("Sales · 9 stages");
    expect(html).toContain("Consulting · 6 stages");
    expect(html).toContain('aria-label="Edit stages for Direct Mail"');
    expect(html).toContain('aria-label="Edit stages for Marketing Agency Services"');
  });

  it("does not ship the Copy from Pipedrive card", () => {
    const html = renderView(ASSIGNMENT_OK);
    expect(html).not.toContain("Pipedrive");
  });

  it("names the lost-access bar for a saved single person who lost access and opens the Pick a person placeholder", () => {
    const html = renderView(ASSIGNMENT_SINGLE_LOST);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Ben E. no longer has Sales access");
    expect(html).toContain("Pick a person");
    expect(html).toContain('aria-label="Person who gets every new lead"');
  });
});
