import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ActivitiesPageData } from "@/lib/sales/activities-page";
import type { BoardCard, BoardPageData, BoardStage } from "@/lib/sales/board";
import type { PersonPanelData } from "@/lib/sales/contact-panel";
import type { ContactsPageData, PersonRow } from "@/lib/sales/contacts-page";
import type { DashboardData } from "@/lib/sales/dashboard";
import type { DealPanelData } from "@/lib/sales/deal-panel";
import type { LeadPanelData } from "@/lib/sales/lead-panel";
import type { LeadsPageData } from "@/lib/sales/leads-page";

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
const { ContactsView } = await import("@/components/sales/contacts-view");
const { DashboardView } = await import("@/components/sales/dashboard-view");
const { LeadsView } = await import("@/components/sales/leads-view");
const { ContactPanelBody } = await import("@/components/sales/contact-panel");
const { DealFiles } = await import("@/components/sales/deal-files");
const { DealPanelHeader } = await import("@/components/sales/deal-panel-header");
const { LeadPanelBody } = await import("@/components/sales/lead-panel");
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
  { id: "u1", name: "Ben S." },
  { id: "u2", name: "Dana Q." },
];
const VIEWER = { userId: "u1", isAdmin: false };

function boardData(view: "board" | "list"): BoardPageData {
  return {
    query: { pipeline: "direct-mail", view, scope: "everyone", status: "open", next: "any", stage: null, q: "", cursor: null },
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
      parent: { kind: "deal", id: "d1", title: "Bright Smile Dental", ownerId: "u1" },
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
    expectedCloseDate: null,
  },
  pipeline: PIPELINE,
  stages: STAGES,
  openActivities: [],
  fields: [],
  members: MEMBERS,
  canEdit: true,
  territoryHold: null,
  files: [],
};

// Every box filled, so every row's pills, avatars and screen-reader words render.
const DASHBOARD: DashboardData = {
  scope: "everyone",
  canSeeEveryone: true,
  viewerName: "Ben Example",
  members: MEMBERS,
  kpis: { openDeals: 3, pipelineCents: 4320000, wonThisMonthCents: 3240000, wonThisMonthCount: 2, overdueActivities: 2 },
  forecast: { thisMonthCents: 432000, nextMonthCents: 0, noCloseDateCount: 2 },
  today: [
    {
      id: "a1",
      type: "CALL",
      subject: "Follow-up call",
      dueAt: "2026-11-03T15:00:00.000Z",
      hasTime: true,
      ownerId: "u1",
      parent: { kind: "lead", id: "l1", title: "Crestview Dental" },
    },
  ],
  todayCount: 1,
  noNextStep: [
    { kind: "deal", id: "d1", title: "Bright Smile Dental", since: "2026-10-20T15:00:00.000Z", stageName: "Demo Complete", ownerId: "u1" },
  ],
  noNextStepCount: 1,
  followUp: [
    {
      id: "d2",
      title: "Oak Creek Dental",
      pipelineName: "Direct Mail",
      valueCents: 1440000,
      mrrCents: 120000,
      ownerId: "u2",
      next: { type: "CALL", subject: "Check in", dueAt: "2026-11-09T15:00:00.000Z", hasTime: false },
    },
  ],
  followUpPipelineKey: "direct-mail",
  recent: [
    {
      id: "h1",
      at: "2026-11-05T14:00:00.000Z",
      icon: "stage",
      text: "Moved to Proposal Sent",
      dealId: "d1",
      dealTitle: "Bright Smile Dental",
      actorName: "Ben S.",
    },
  ],
};

// A lead the viewer owns (so it has a tick box) and the phone strip's box above it.
const LEADS: LeadsPageData = {
  query: { scope: "everyone", q: "", cursor: null },
  rows: [
    {
      id: "l1",
      title: "Crestview Dental",
      source: "Check Availability form",
      createdAt: "2026-11-02T15:00:00.000Z",
      ownerId: "u1",
      personName: "Laura B.",
      organizationName: "Crestview Dental",
      zip: "78704",
      next: { type: "CALL", subject: "First call", dueAt: "2026-11-05T15:00:00.000Z", hasTime: false },
    },
  ],
  nextCursor: "l1",
  members: MEMBERS,
  canSeeEveryone: true,
  assignment: { mode: "ROUND_ROBIN", names: ["Ben S.", "Dana Q."], fallbackName: null },
};

// One person the viewer may see, so the Contacts People tab's table wrapper scrolls.
const CONTACT_ROW: PersonRow = {
  kind: "person",
  id: "p1",
  name: "Sarah K.",
  organizationName: "Oak Creek Dental",
  openDeals: 2,
  ownerId: "u1",
};

const CONTACTS: ContactsPageData = {
  query: { tab: "people", scope: "everyone", q: "", cursor: null },
  rows: [CONTACT_ROW],
  nextCursor: null,
  members: MEMBERS,
  canSeeEveryone: true,
};

// A person the viewer owns, with a visible organization, one open deal, one converted lead and a visible duplicate.
const CONTACT_PANEL: PersonPanelData = {
  kind: "person",
  person: {
    id: "p1",
    name: "Sarah K.",
    email: "sarah@oak.example",
    phone: "(512) 555-0142",
    role: "Office manager",
    organization: { id: "o1", name: "Oak Creek Dental", visible: true },
    owner: MEMBERS[0],
    createdAt: "2026-11-02T15:00:00.000Z",
  },
  deals: [
    { id: "d1", title: "Oak Creek Dental", status: "OPEN", stageName: "Demo Booked", valueCents: 1440000 },
  ],
  leads: [{ id: "l1", title: "Oak Creek Dental", status: "CONVERTED" }],
  counts: { deals: 1, leads: 1 },
  duplicates: { matches: [{ id: "p2", name: "Sarah Example" }], hiddenMatch: false },
  canEdit: true,
  canMerge: true,
  redirectedFrom: null,
};

// An open lead the viewer owns, with a next step and a Details field, so every part of the panel renders.
const LEAD_PANEL: LeadPanelData = {
  lead: {
    id: "l1",
    title: "Crestview Dental",
    status: "OPEN",
    source: "Check Availability form",
    createdAt: "2026-11-02T15:00:00.000Z",
    owner: MEMBERS[0],
    organization: { id: "o1", name: "Crestview Dental" },
    person: { id: "pe1", name: "Laura B." },
  },
  convertedDeal: null,
  openActivities: [
    { id: "a1", type: "CALL", subject: "First call", dueAt: "2026-11-05T15:00:00.000Z", hasTime: false, createdBy: "u1", ownerId: "u1" },
  ],
  fields: [{ key: "practice-zip", label: "Practice ZIP", fieldType: "TEXT", options: [], value: "78704" }],
  members: MEMBERS,
  canEdit: true,
  canRestore: false,
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

  it("the Leads Inbox table wrapper is relative", () => {
    const html = clean(renderToString(createElement(LeadsView, { data: LEADS, viewer: VIEWER, now: NOW, openNew: false })));
    expect(html).toContain('aria-label="Select Crestview Dental"');
    expect(html).toContain('class="sr-only"');
    expectScrollersContain(html, 1);
  });

  it("the Contacts page's table wrapper is relative", () => {
    const html = clean(renderToString(createElement(ContactsView, { data: CONTACTS, viewer: VIEWER, openNew: null })));
    expect(html).toContain(">Sarah K.</a>");
    expect(html).toContain('class="sr-only"');
    expectScrollersContain(html, 1);
  });

  it("the Sales dashboard has no scroller that would let its screen-reader text out", () => {
    const html = clean(renderToString(createElement(DashboardView, { data: DASHBOARD, now: NOW })));
    // The dashboard draws no scroller today (rows cut long names short instead);
    // any scroller added later must be relative too.
    expect(html).toContain("Expected to close");
    expect(html).toContain('class="sr-only"');
    expectScrollersContain(html, 0);
  });

  it("the lead panel's scrolling body is relative", () => {
    const html = clean(
      renderToString(createElement(LeadPanelBody, { data: LEAD_PANEL, now: new Date(NOW), onChanged: vi.fn(), onClose: vi.fn() })),
    );
    expect(html).toContain("First call");
    expect(html).toContain('class="sr-only"');
    expectScrollersContain(html, 1);
  });

  it("the contact panel's scrolling body is relative", () => {
    const html = clean(
      renderToString(
        createElement(ContactPanelBody, { data: CONTACT_PANEL, now: new Date(NOW), onChanged: vi.fn(), onClose: vi.fn() }),
      ),
    );
    expect(html).toContain("Sarah K.");
    expect(html).toContain('class="sr-only"');
    expectScrollersContain(html, 1);
  });

  it("the deal panel's Files section renders a scroll-safe layout (Task 24)", () => {
    const html = clean(
      renderToString(
        createElement(DealFiles, {
          files: [
            {
              id: "f1",
              name: "contract.pdf",
              sizeBytes: 1572864,
              contentType: "application/pdf",
              stageName: "Proposal Sent",
              uploadedBy: "Ben S.",
              createdAt: "2026-11-05T14:00:00.000Z",
              canRemove: true,
            },
          ],
          canEdit: true,
          now: new Date(NOW),
          onAddFile: vi.fn(),
          onChanged: vi.fn(),
        }),
      ),
    );
    expect(html).toContain("contract.pdf");
    // DealFiles draws no scroller of its own (file rows wrap on phones), but any
    // scroller added later must be relative too.
    for (const classes of scrollerClasses(html)) expect(classes, classes.join(" ")).toContain("relative");
  });

  it("the deal panel's stage bar (it scrolls sideways on phones) is relative", () => {
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
