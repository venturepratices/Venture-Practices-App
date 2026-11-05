import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BoardCard, BoardPageData, BoardStage } from "@/lib/sales/board";

// A server render of the Deals screen with canned data. Node has no browser, so
// this cannot click anything; it proves the board, list and toolbar render
// without throwing and carry the labels, words and sizes the plan asks for.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/deals",
  useSearchParams: () => new URLSearchParams("pipeline=direct-mail"),
}));

const { DealsView } = await import("@/components/sales/deals-view");

const NOW = "2026-11-05T15:00:00.000Z";

function stage(id: string, name: string, extra: Partial<BoardStage> = {}): BoardStage {
  return {
    id,
    key: id,
    name,
    position: 0,
    probability: 30,
    isWon: false,
    isLost: false,
    requiresValue: false,
    isNoShow: false,
    rottingDays: 14,
    ...extra,
  };
}

const DEMO = stage("s3", "Demo Complete");
const PROPOSAL = stage("s4", "Proposal Sent", { requiresValue: true, probability: 60 });

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

// A demo booked for tomorrow at 2 PM Eastern (19:00 UTC in November).
const BOOKED: BoardCard = {
  ...CARD,
  id: "d3",
  title: "Oak Family Dentistry",
  next: { type: "MEETING", subject: "Demo", dueAt: "2026-11-06T19:00:00.000Z", hasTime: true },
};

function pageData(extra: Partial<BoardPageData> = {}): BoardPageData {
  const pipeline = { id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES" as const };
  return {
    query: { pipeline: "direct-mail", view: "board", scope: "everyone", status: "open", next: "any", q: "", cursor: null },
    pipelines: [pipeline, { id: "p2", key: "new-mover-mail", name: "New Mover Mail", kind: "SALES" }],
    pipeline,
    stages: [DEMO, PROPOSAL],
    columns: [
      { stage: DEMO, count: 51, totalCents: 1440000, cards: [CARD] },
      { stage: PROPOSAL, count: 0, totalCents: 0, cards: [] },
    ],
    list: null,
    totals: { count: 51, valueCents: 1440000 },
    members: [
      { id: "u1", name: "Ben Shaver" },
      { id: "u2", name: "Robert Ortiz" },
    ],
    canSeeEveryone: true,
    ...extra,
  };
}

/** The server HTML, without the comment markers React puts between adjacent text pieces. */
function render(data: BoardPageData, viewer = { userId: "u1", isAdmin: false }) {
  return renderToString(createElement(DealsView, { data, viewer, openNew: false, now: NOW })).replaceAll("<!-- -->", "");
}

/** One stage's column (its <section>) in the board HTML. */
function column(html: string, stageName: string) {
  const start = html.indexOf(`aria-label="${stageName},`);
  expect(start, stageName).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start));
}

describe("Deals screen (server render)", () => {
  it("renders the toolbar, the columns and a card", () => {
    const html = render(pageData());
    expect(html).toContain('aria-label="Pipeline"');
    expect(html).toContain('aria-label="Board view"');
    expect(html).toContain('aria-label="List view"');
    expect(html).toContain("Everyone");
    expect(html).toContain("Just me");
    expect(html).toContain('placeholder="Filter this board"');
    expect(html).toContain('aria-label="Add deal"');
    expect(html).toContain("$14,400 · 51 deals");
    expect(html).toContain('aria-label="Demo Complete, 51 deals"');
    expect(html).toContain('title="Win chance 30%"');
    expect(html).toContain("Showing 1 of 51.");
    expect(html).toContain("Open list view");
    expect(html).toContain("Swipe sideways for more stages. Press and hold a deal to move it.");
  });

  it("never lets a toolbar control that fills its line on a phone shrink to nothing", () => {
    // At 375px the pipeline picker (flex-1 from a zero basis, min-w-0) was left
    // about 21px: an empty box with the pipeline name invisible (C2). A control
    // that grows into the space left on its line needs a minimum on phones of
    // at least 8rem, or a line of its own.
    const html = render(pageData());
    const growers = [...html.matchAll(/class="([^"]*)"/g)]
      .map((match) => match[1].split(/\s+/))
      .filter((classes) => classes.some((name) => /^max-sm:(?:flex-1|flex-auto|grow)$/.test(name)));
    expect(growers.length).toBeGreaterThanOrEqual(2); // the pipeline picker and the search box
    for (const classes of growers) {
      const rem = classes.reduce((best, name) => {
        if (name === "max-sm:basis-full") return Infinity;
        const scale = /^max-sm:min-w-(\d+(?:\.\d+)?)$/.exec(name);
        if (scale) return Math.max(best, Number(scale[1]) / 4);
        const exact = /^max-sm:min-w-\[(\d+(?:\.\d+)?)rem\]$/.exec(name);
        return exact ? Math.max(best, Number(exact[1])) : best;
      }, 0);
      expect(rem, classes.join(" ")).toBeGreaterThanOrEqual(8);
    }
    expect(html).toMatch(/aria-label="Pipeline"[^>]*class="[^"]*max-sm:min-w-/);
  });

  it("explains an empty later column and says where new deals start (Decision 20, spec 7.12)", () => {
    const html = render(pageData());
    const proposal = column(html, "Proposal Sent");
    expect(proposal).toContain("No deals in Proposal Sent yet.");
    expect(proposal).toContain("New deals start in Demo Complete. Move them here when they reach this stage.");
    // Add deal always starts a deal in the first stage (spec rule 1): a "+ Deal" in
    // this column read as "add one here", and the new deal then landed off screen (M1).
    expect(proposal).not.toContain('aria-label="Add deal"');
    expect(proposal).not.toContain("<button");
  });

  it("offers + Deal in an empty first column, where new deals start", () => {
    const first = column(
      render(
        pageData({
          columns: [
            { stage: DEMO, count: 0, totalCents: 0, cards: [] },
            { stage: PROPOSAL, count: 1, totalCents: 1440000, cards: [{ ...CARD, stageId: "s4" }] },
          ],
        }),
      ),
      "Demo Complete",
    );
    expect(first).toContain("No deals in Demo Complete yet.");
    expect(first).toContain("New deals start here.");
    expect(first).toMatch(/<button[^>]*aria-label="Add deal"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Deal<\/button>/);
  });

  it("keeps empty columns to the mockup line while filters are on (the filter bar has the action)", () => {
    const html = render(
      pageData({
        query: { pipeline: "direct-mail", view: "board", scope: "everyone", status: "open", next: "overdue", q: "", cursor: null },
      }),
    );
    const proposal = column(html, "Proposal Sent");
    expect(proposal).toContain("No deals in Proposal Sent yet.");
    expect(proposal).not.toContain("Add deal");
  });

  it("draws the card like the mockup: value, monthly value, overdue pill, rotting days, owner", () => {
    const html = render(pageData());
    expect(html).toContain("Bright Smile Dental");
    expect(html).toContain("$1,200/mo");
    expect(html).toContain("Overdue 2d");
    expect(html).toContain('aria-label="16 days in this stage, idle too long"');
    expect(html).toContain('aria-label="Owner: Ben Shaver"');
    expect(html).toContain(">BS<");
    // Only the owner or an admin may drag it: the owner's card is draggable.
    expect(html).toContain('aria-roledescription="deal"');
  });

  it("says the chosen time on the card's next-step pill and in its label", () => {
    const html = render(
      pageData({
        columns: [
          { stage: DEMO, count: 1, totalCents: 1440000, cards: [BOOKED] },
          { stage: PROPOSAL, count: 0, totalCents: 0, cards: [] },
        ],
      }),
    );
    expect(html).toContain("Tomorrow, 2:00 PM");
    expect(html).toContain("Meeting Tomorrow, 2:00 PM");
    // A 240px column leaves about 200px inside a card: with a time and an idle-days
    // pill the row can be wider, so it wraps (the avatar drops a line) instead of spilling out.
    expect(html).toMatch(/<div class="mt-1 flex flex-wrap items-center gap-1\.5"><span[^>]*bg-status-success/);
  });

  it("shows the chosen time in the list view's Next activity too", () => {
    const html = render(
      pageData({
        query: { pipeline: "direct-mail", view: "list", scope: "everyone", status: "open", next: "any", q: "", cursor: null },
        columns: null,
        list: { rows: [{ ...BOOKED, stageName: "Demo Complete" }], nextCursor: null },
      }),
    );
    expect(html).toContain("Tomorrow, 2:00 PM");
  });

  it("labels the Won drop zone in a green dark enough to read on white (spec 7.11)", () => {
    const html = render(pageData());
    // green-600 text on white is 3.2:1; green-700 is 4.9:1.
    expect(html).toMatch(/class="[^"]*border-green-700 text-green-700[^"]*"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Won</);
    expect(html).not.toContain("border-green-600 text-green-600");
  });

  it("does not make someone else's card draggable", () => {
    const html = render(pageData(), { userId: "u2", isAdmin: false });
    expect(html).not.toContain('aria-roledescription="deal"');
    expect(html).toContain('role="button"');
  });

  it("hides Everyone / Just me for someone who sees only their own deals", () => {
    const html = render(pageData({ canSeeEveryone: false }));
    expect(html).not.toContain("Just me");
  });

  it("marks active filters on the Filter button and says when nothing matches", () => {
    const html = render(
      pageData({
        query: { pipeline: "direct-mail", view: "board", scope: "everyone", status: "won", next: "overdue", q: "", cursor: null },
        columns: [
          { stage: DEMO, count: 0, totalCents: 0, cards: [] },
          { stage: PROPOSAL, count: 0, totalCents: 0, cards: [] },
        ],
        totals: { count: 0, valueCents: 0 },
      }),
    );
    expect(html).toContain('aria-label="Filter, 2 active"');
    expect(html).toContain("No deals match these filters.");
    expect(html).toContain("Clear filters");
  });

  it("shows the empty pipeline once, in the first column, with a way to add a deal", () => {
    const html = render(
      pageData({
        columns: [
          { stage: DEMO, count: 0, totalCents: 0, cards: [] },
          { stage: PROPOSAL, count: 0, totalCents: 0, cards: [] },
        ],
        totals: { count: 0, valueCents: 0 },
      }),
    );
    expect(html).toContain("No deals in Direct Mail yet.");
    expect(html).toContain("Add a deal by hand to get started.");
    expect(html).not.toContain("No deals in Demo Complete yet.");
    // The other columns keep just the mockup line: one way to add a deal is enough.
    const proposal = column(html, "Proposal Sent");
    expect(proposal).toContain("No deals in Proposal Sent yet.");
    expect(proposal).not.toContain("Add deal");
  });

  it("renders the list view with its columns, stacked-card labels and Show more", () => {
    const html = render(
      pageData({
        query: { pipeline: "direct-mail", view: "list", scope: "everyone", status: "open", next: "any", q: "", cursor: null },
        columns: null,
        list: { rows: [{ ...CARD, stageName: "Demo Complete" }], nextCursor: "d1" },
      }),
    );
    for (const heading of ["Deal", "Person", "Stage", "Value", "Next activity", "Owner"]) {
      expect(html).toContain(`>${heading}</th>`);
    }
    for (const label of ["Person:", "Stage:", "Value:", "Next:", "Owner:"]) expect(html).toContain(label);
    expect(html).toContain("Ben S.");
    expect(html).toContain('href="/sales/deals?pipeline=direct-mail&amp;deal=d1"');
    expect(html).toContain("Show more");
  });
});
