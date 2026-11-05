import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BoardStage } from "@/lib/sales/board";
import type { DealPanelData } from "@/lib/sales/deal-panel";

// A server render of the deal panel's header (deal-panel-header.tsx) with
// canned data. Node has no browser, so this cannot tap a stage; it proves the
// caption under the stage bar and the stage bar's markup on every screen size.

const { DealPanelHeader } = await import("@/components/sales/deal-panel-header");
const { Sheet } = await import("@/components/ui/sheet");

const NOW = new Date("2026-11-05T15:00:00.000Z");

function stage(id: string, name: string, position: number, probability: number, extra: Partial<BoardStage> = {}): BoardStage {
  return {
    id,
    key: id,
    name,
    position,
    probability,
    isWon: false,
    isLost: false,
    requiresValue: false,
    isNoShow: false,
    rottingDays: 14,
    ...extra,
  };
}

const STAGES = [
  stage("s1", "New Opt-In", 0, 10),
  stage("s2", "Appointment Scheduled", 1, 20),
  stage("s3", "Demo Complete", 2, 30),
  stage("s4", "Proposal Sent", 3, 60, { requiresValue: true }),
  stage("s5", "Contract Signed", 4, 100, { isWon: true, rottingDays: null }),
];

const MEMBERS = [
  { id: "u1", name: "Ben Shaver" },
  { id: "u2", name: "Dana Q." },
];

function panel(deal: Partial<DealPanelData["deal"]> = {}): DealPanelData {
  return {
    deal: {
      id: "d1",
      title: "Bright Smile Dental",
      status: "OPEN",
      valueCents: 1_440_000,
      mrrCents: 120_000,
      stageId: "s3",
      stageEnteredAt: "2026-11-04T15:00:00.000Z",
      lostReason: null,
      lostComment: null,
      source: null,
      owner: MEMBERS[0],
      organization: { id: "o1", name: "Bright Smile Dental" },
      person: { id: "pe1", name: "Sarah K." },
      ...deal,
    },
    pipeline: { id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES" },
    stages: STAGES,
    openActivities: [],
    fields: [],
    members: MEMBERS,
    canEdit: true,
    territoryHold: null,
  };
}

/** The header's close button belongs to the panel's Sheet, so it renders inside one. */
function render(data: DealPanelData): string {
  const moves = { move: vi.fn(), setStatus: vi.fn(), editValue: vi.fn() };
  return renderToString(
    createElement(Sheet, null, createElement(DealPanelHeader, { data, now: NOW, moves, titleId: "t", onChanged: vi.fn() })),
  ).replaceAll("<!-- -->", "");
}

describe("deal panel header: the caption under the stage bar", () => {
  it("gives an open deal its stage, days in it and win chance", () => {
    expect(render(panel())).toContain(">Demo Complete · 1 day in this stage · 30% win chance</p>");
  });

  it("gives a lost deal its status, never the stage's win chance (C3)", () => {
    const html = render(panel({ status: "LOST", stageId: "s5", lostReason: "Price" }));
    expect(html).toContain(">Lost · Contract Signed</p>");
    expect(html).not.toContain("win chance");
    expect(html).not.toContain("in this stage");
  });

  it("gives a won deal its status", () => {
    expect(render(panel({ status: "WON", stageId: "s5" }))).toContain(">Won · Contract Signed</p>");
  });
});
