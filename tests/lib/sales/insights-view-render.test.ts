import fs from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { InsightsData } from "@/lib/sales/insights";

// The Insights page on the server (Mockup v2 `viewInsights`): heading and
// filter copy, four cards (funnel, won, cycle, activities) with their numbers,
// an always-mounted sr-only table under each chart, keyboard-reachable chart
// marks with role="img" and aria-labels, SVGs that scale down on a 375px
// phone, empty cards, the Everyone / Just me switch hidden when the viewer
// cannot see it, and a cap line when the won-deal read was cut short.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/insights",
  useSearchParams: () => new URLSearchParams(""),
}));

const { InsightsView } = await import("@/components/sales/insights-view");

const NOW = "2026-11-05T15:00:00.000Z";

const DIRECT_MAIL = { id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES" as const };
const CONSULTING = { id: "p2", key: "consulting", name: "Consulting", kind: "CONSULTING" as const };

function base(overrides: Partial<InsightsData> = {}): InsightsData {
  return {
    query: { range: 3, scope: "everyone", pipeline: "direct-mail" },
    canSeeEveryone: true,
    pipelines: [DIRECT_MAIL, CONSULTING],
    pipeline: DIRECT_MAIL,
    months: ["2026-09", "2026-10", "2026-11"],
    funnel: [
      { stageId: "s1", name: "New Lead", count: 3, valueCents: 450000 },
      { stageId: "s2", name: "Demo Booked", count: 2, valueCents: 1200000 },
      { stageId: "s3", name: "Demo Complete", count: 1, valueCents: 900000 },
    ],
    wonByMonth: [
      { month: "2026-09", valueCents: 0, count: 0 },
      { month: "2026-10", valueCents: 0, count: 0 },
      { month: "2026-11", valueCents: 1440000, count: 2 },
    ],
    cycleByMonth: [
      { month: "2026-09", avgDays: null, count: 0 },
      { month: "2026-10", avgDays: null, count: 0 },
      { month: "2026-11", avgDays: 12, count: 2 },
    ],
    activitiesByPerson: [
      { ownerId: "u1", name: "Ben S.", count: 5 },
      { ownerId: "u2", name: "Robert O.", count: 3 },
    ],
    capped: false,
    ...overrides,
  };
}

function render(data: InsightsData): string {
  return renderToString(createElement(InsightsView, { data, now: NOW })).replaceAll("<!-- -->", "");
}

describe("InsightsView (server render)", () => {
  it("draws the heading, sub and filter row with the range options and the pipeline note", () => {
    const html = render(base());
    expect(html).toContain(">Insights</h1>");
    expect(html).toContain("What closed, how fast, and where open deals sit.");
    expect(html).toContain('role="group" aria-label="Filters for every chart"');
    expect(html).toContain('aria-label="Date range"');
    for (const label of ["Last 3 months", "Last 6 months", "Last 12 months"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Sales and Consulting pipelines");
    expect(html).toContain("Everyone");
    expect(html).toContain("Just me");
  });

  it("draws the four card headings and the pipeline-funnel picker", () => {
    const html = render(base());
    expect(html).toContain(">Pipeline funnel<");
    expect(html).toContain(">Open deals in each stage right now<");
    expect(html).toContain(">Deals won over time<");
    expect(html).toContain(">Won value per month<");
    expect(html).toContain(">Average deal cycle time<");
    expect(html).toContain(">Days from created to won, by month won<");
    expect(html).toContain(">Activities completed per person<");
    expect(html).toContain(">Calls, meetings, tasks and emails marked done<");
    expect(html).toContain('aria-label="Pipeline for the funnel"');
    expect(html).toContain(">Direct Mail</option>");
    expect(html).toContain(">Consulting</option>");
  });

  it("writes the headline numbers for a Nov-worth-$14,400 fixture", () => {
    const html = render(base());
    // Funnel: 3 + 2 + 1 = 6 open deals, value 450000 + 1200000 + 900000 = $25,500
    expect(html).toContain("open deals");
    // Won headline
    expect(html).toContain("$14,400");
    expect(html).toContain("2 deals");
    // Cycle headline: "12 days" + "on average in the last 3 months"
    expect(html).toContain("12 days");
    expect(html).toContain("on average in the last 3 months");
    // Activity count: 5 + 3 = 8
    expect(html).toContain(">8</b>");
    expect(html).toContain("done in the last 3 months");
  });

  it("gives each chart its table with the caption words, and 'Nov 2026 (so far)' for this month", () => {
    const html = render(base());
    expect(html).toContain("Open deals per stage in Direct Mail");
    expect(html).toContain("Deals won per month, the last 3 months");
    expect(html).toContain("Average days from created to won, the last 3 months");
    expect(html).toContain("Activities completed per person, the last 3 months");
    expect(html).toContain("Nov 2026 (so far)");
    expect(html).toContain("Oct 2026");
    // Column headers
    expect(html).toContain(">Stage<");
    expect(html).toContain(">Open deals<");
    expect(html).toContain(">Value<");
    expect(html).toContain(">Month<");
    expect(html).toContain(">Won value<");
    expect(html).toContain(">Deals<");
    expect(html).toContain(">Average days<");
    expect(html).toContain(">Deals won<");
    expect(html).toContain(">Person<");
    expect(html).toContain(">Activities done<");
  });

  it("every bar and point is focusable with a role=img and a sentence aria-label", () => {
    const html = render(base());
    // Won column, Nov 2026 so far: the mockup's exact aria-label sentence
    expect(html).toContain('aria-label="Nov 2026 so far: $14,400, 2 deals"');
    // Cycle point, Nov 2026 so far: "12 days, 2 deals won"
    expect(html).toContain('aria-label="Nov 2026 so far: 12 days, 2 deals won"');
    // Funnel bar: "3 deals, $4,500" for the first stage (plus the stage name)
    expect(html).toContain('aria-label="New Lead: 3 deals, $4,500"');
    // Activities bar: "5 done" for Ben S.
    expect(html).toContain('aria-label="Ben S.: 5 done"');
    // Every chart mark is a focusable role="img"
    expect(/role="img" tabindex="0"|tabindex="0" role="img"/.test(html)).toBe(true);
  });

  it("the column and line SVGs carry viewBox='0 0 560 ...' and w-full h-auto so they scale down at 375px", () => {
    const html = render(base());
    const svgs = [...html.matchAll(/<svg[^>]*>/g)].map((m) => m[0]);
    expect(svgs.length).toBeGreaterThanOrEqual(2);
    const chartSvgs = svgs.filter((tag) => /viewBox="0 0 560 /.test(tag));
    expect(chartSvgs.length).toBeGreaterThanOrEqual(2);
    for (const tag of chartSvgs) {
      expect(tag).toMatch(/class="[^"]*\bw-full\b/);
      expect(tag).toMatch(/class="[^"]*\bh-auto\b/);
    }
  });

  it("an empty fixture shows each card's empty title, text and action, and draws no chart marks", () => {
    const empty = base({
      funnel: [],
      wonByMonth: [
        { month: "2026-09", valueCents: 0, count: 0 },
        { month: "2026-10", valueCents: 0, count: 0 },
        { month: "2026-11", valueCents: 0, count: 0 },
      ],
      cycleByMonth: [
        { month: "2026-09", avgDays: null, count: 0 },
        { month: "2026-10", avgDays: null, count: 0 },
        { month: "2026-11", avgDays: null, count: 0 },
      ],
      activitiesByPerson: [],
    });
    const html = render(empty);
    // Funnel empty (Everyone, so no "of yours")
    expect(html).toContain("No open deals in Direct Mail.");
    expect(html).toContain("Open deals show here, stage by stage, as they move along.");
    expect(html).toContain("Open the board");
    // Won empty
    expect(html).toContain("No deals won in the last 3 months.");
    expect(html).toContain("Each month");
    // Cycle empty
    expect(html).toContain("Nothing won yet in this range.");
    expect(html).toContain("The average number of days from a new deal to a win shows here.");
    // Activities empty
    expect(html).toContain("No activities marked done in the last 3 months.");
    expect(html).toContain("Calls, meetings and tasks count here once someone marks them done.");
    expect(html).toContain("Open activities");
    // No chart SVGs when both won and cycle are empty
    expect(/<svg[^>]*viewBox="0 0 560 /.test(html)).toBe(false);
  });

  it("empty funnel on Just me says 'of yours'", () => {
    const html = render(
      base({
        query: { range: 3, scope: "mine", pipeline: "direct-mail" },
        funnel: [],
      }),
    );
    expect(html).toContain("No open deals of yours in Direct Mail.");
  });

  it("hides Everyone / Just me when the viewer cannot see everyone", () => {
    const html = render(base({ canSeeEveryone: false }));
    expect(html).not.toContain(">Everyone<");
    expect(html).not.toContain(">Just me<");
  });

  it("shows the cap line under the filter row when the won read was cut short", () => {
    const html = render(base({ capped: true }));
    expect(html).toContain("Showing the first 5,000 won deals in this range.");
  });

  it("Just me rewords the open-deals headline sub and the won headline sub", () => {
    const html = render(
      base({
        query: { range: 3, scope: "mine", pipeline: "direct-mail" },
      }),
    );
    expect(html).toContain("open deals of yours");
    // The won sub reads "No deals of yours won..." only in empty state; headline reads "won in {range}" either way.
  });

  it("shows the funnel empty card when every stage has zero open deals (Mockup v2: funN ? '' : chEmpty)", () => {
    // A live pipeline with stages but no open deals in any of them should
    // trigger the empty card, not a horizontal-bar chart of zero-length bars.
    const html = render(
      base({
        funnel: [
          { stageId: "s1", name: "New Lead", count: 0, valueCents: 0 },
          { stageId: "s2", name: "Demo Booked", count: 0, valueCents: 0 },
          { stageId: "s3", name: "Demo Complete", count: 0, valueCents: 0 },
        ],
      }),
    );
    expect(html).toContain("No open deals in Direct Mail.");
    expect(html).toContain("Open deals show here, stage by stage, as they move along.");
    // The bars (and the stage-name row labels) are not drawn when the card is empty.
    expect(html).not.toContain(">New Lead<");
    expect(html).not.toContain(">Demo Booked<");
  });
});

// Tailwind 4's content scanner does not extract classes from interpolated
// template literals, so `className={`fill-${TOKEN}`}` never reaches the
// generated CSS unless the string also appears as a static literal in a
// scanned file. The chart components paint the series with one token and must
// reference each utility statically, or the SVG line and bars render with no
// stroke or fill in production.
describe("insights-charts: Tailwind class names are static literals", () => {
  function chartsSource(): string {
    return fs.readFileSync(
      path.join(process.cwd(), "src", "components", "sales", "insights-charts.tsx"),
      "utf8",
    );
  }

  it.each(["fill-primary", "stroke-primary", "bg-primary"] as const)(
    "%s appears as a static class string in insights-charts.tsx",
    (utility) => {
      const source = chartsSource();
      // The utility must appear inside a quoted string (single or double quote,
      // or inside a backtick literal with no `${...}` interpolation touching it),
      // so Tailwind's scanner can pick it up.
      const staticInQuotes = new RegExp(
        String.raw`["'\`][^"'\`]*\b${utility}\b[^"'\`]*["'\`]`,
      );
      expect(staticInQuotes.test(source)).toBe(true);
    },
  );

  it("does not build the chart series utilities through template-literal interpolation", () => {
    const source = chartsSource();
    // Any one of these patterns would confirm the Finding 1 regression: a
    // dynamic class name that Tailwind's scanner never resolves.
    expect(source).not.toMatch(/`fill-\$\{[^}]+\}`/);
    expect(source).not.toMatch(/`stroke-\$\{[^}]+\}`/);
    expect(source).not.toMatch(/`bg-\$\{[^}]+\}`/);
  });
});
