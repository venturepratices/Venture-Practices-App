import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ActivitiesPageData } from "@/lib/sales/activities-page";
import type { BoardCard, BoardPageData, BoardStage } from "@/lib/sales/board";
import type { DealPanelData } from "@/lib/sales/deal-panel";

// Screen-reader-only text (Tailwind `sr-only`) is a 1px box with
// position: absolute. Its containing block is the nearest positioned ancestor;
// when none sits between it and <body>, a card in a column past the right edge
// of the board places that 1px box outside <html>, the page grows wider than
// the screen, and on a phone the deal panel and Add deal render 600px wide and
// are cut off (controller click-through, C1). A scroller that is `relative`
// holds that text inside itself, where its own overflow clips it. These server
// renders check every Sales scroller (and the panel's stage bar) carries
// `relative`.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/deals",
  useSearchParams: () => new URLSearchParams("pipeline=direct-mail"),
}));

const { DealsView } = await import("@/components/sales/deals-view");
const { ActivitiesView } = await import("@/components/sales/activities-view");
const { DealPanelHeader } = await import("@/components/sales/deal-panel-header");
const { Sheet } = await import("@/components/ui/sheet");

const NOW = "2026-11-05T15:00:00.000Z";

function stage(id: string, name: string, position: number): BoardStage {
  return {
    id,
    key: id,
    name,
    position,
    probability: 30,
    isWon: false,
    isLost: false,
    requiresValue: false,
    isNoShow: false,
    rottingDays: 14,
  };
}

const STAGES = [stage("s1", "New Lead", 0), stage("s2", "Demo Booked", 1), stage("s3", "Demo Complete", 2)];

// A card in the third column: the one whose screen-reader text escaped the board.
const CARD: BoardCard = {
  id: "d1",
  title: "Bright Smile Dental",
  valueCents: 1440000,
  mrrCents: 120000,
  stageId: "s3",
  status: "OPEN",
  stageEnteredAt: "2026-10-20T15:00:00.000Z",
  ownerId: "u1",
  personName: "Sarah K.",
  organizationName: "Bright Smile Dental",
  next: { type: "CALL", subject: "Follow-up call", dueAt: "2026-11-03T15:00:00.000Z", hasTime: true },
};

const PIPELINE = { id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES" as const };
const MEMBERS = [
  { id: "u1", name: "Ben Shaver" },
  { id: "u2", name: "Dana Q." },
];
const VIEWER = { userId: "u1", isAdmin: false };

function boardData(view: "board" | "list"): BoardPageData {
  return {
    query: { pipeline: "direct-mail", view, scope: "everyone", status: "open", next: "any", q: "", cursor: null },
    pipelines: [PIPELINE],
    pipeline: PIPELINE,
    stages: STAGES,
    columns:
      view === "board"
        ? STAGES.map((s) => ({ stage: s, count: s.id === "s3" ? 1 : 0, totalCents: s.id === "s3" ? 1440000 : 0, cards: s.id === "s3" ? [CARD] : [] }))
        : null,
    list: view === "list" ? { rows: [{ ...CARD, stageName: "Demo Complete" }], nextCursor: null } : null,
    totals: { count: 1, valueCents: 1440000 },
    members: MEMBERS,
    canSeeEveryone: true,
  };
}

const ACTIVITIES: ActivitiesPageData = {
  query: { when: "open", type: "all", scope: "everyone", cursor: null },
  rows: [
    {
      id: "a1",
      type: "CALL",
      subject: "Follow-up call",
      dueAt: "2026-11-03T15:00:00.000Z",
      hasTime: true,
      doneAt: null,
      ownerId: "u1",
      deal: { id: "d1", title: "Bright Smile Dental", ownerId: "u1" },
    },
  ],
  nextCursor: null,
  members: MEMBERS,
  canSeeEveryone: true,
};

const PANEL: DealPanelData = {
  deal: {
    id: "d1",
    title: "Bright Smile Dental",
    status: "OPEN",
    valueCents: 1440000,
    mrrCents: 120000,
    stageId: "s3",
    stageEnteredAt: "2026-10-20T15:00:00.000Z",
    lostReason: null,
    lostComment: null,
    source: null,
    owner: MEMBERS[0],
    organization: { id: "o1", name: "Bright Smile Dental" },
    person: { id: "pe1", name: "Sarah K." },
  },
  pipeline: PIPELINE,
  stages: STAGES,
  openActivities: [],
  fields: [],
  members: MEMBERS,
  canEdit: true,
  territoryHold: null,
};

const clean = (html: string) => html.replaceAll("<!-- -->", "");

/** The class lists of every element that scrolls (overflow auto, on any axis, at any size). */
function scrollerClasses(html: string): string[][] {
  return [...html.matchAll(/class="([^"]*)"/g)]
    .map((match) => match[1].split(/\s+/))
    .filter((classes) => classes.some((name) => /^(?:[\w-]+:)?overflow(?:-[xy])?-auto$/.test(name)));
}

function expectScrollersContain(html: string, expectedAtLeast: number) {
  const scrollers = scrollerClasses(html);
  expect(scrollers.length).toBeGreaterThanOrEqual(expectedAtLeast);
  for (const classes of scrollers) expect(classes, classes.join(" ")).toContain("relative");
}

describe("Sales scrollers hold their screen-reader text (server render)", () => {
  it("the board's sideways scroller and every column list are relative", () => {
    const html = clean(renderToString(createElement(DealsView, { data: boardData("board"), viewer: VIEWER, openNew: false, now: NOW })));
    // The board scroller plus one list per column.
    expectScrollersContain(html, 1 + STAGES.length);
  });

  it("the list view's scroller and its table wrapper are relative", () => {
    const html = clean(renderToString(createElement(DealsView, { data: boardData("list"), viewer: VIEWER, openNew: false, now: NOW })));
    expectScrollersContain(html, 2);
  });

  it("the Activities table wrapper is relative", () => {
    const html = clean(renderToString(createElement(ActivitiesView, { data: ACTIVITIES, viewer: VIEWER, now: NOW })));
    expectScrollersContain(html, 1);
  });

  it("the deal panel's stage bar (stage names are screen-reader-only on phones) is relative", () => {
    const moves = { move: vi.fn(), setStatus: vi.fn(), editValue: vi.fn() };
    // The header's close button belongs to the panel's Sheet, so it renders inside one.
    const html = clean(
      renderToString(
        createElement(
          Sheet,
          null,
          createElement(DealPanelHeader, { data: PANEL, now: new Date(NOW), moves, titleId: "t", onChanged: vi.fn() }),
        ),
      ),
    );
    const bar = /<div role="group" aria-label="Stage"[^>]*class="([^"]*)"/.exec(html);
    expect(bar).not.toBeNull();
    expect(bar![1].split(/\s+/)).toContain("relative");
  });
});
