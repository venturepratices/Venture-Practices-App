import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardData } from "@/lib/sales/dashboard";
import { dashboardEmpty, viewAllHrefs } from "@/lib/sales/dashboard-client";
import { endOfDay } from "@/lib/utils";

import { contrast, token, utilityColour } from "./theme-colours";

// A server render of the Sales dashboard with canned data (Mockup v2 `#s=home`).
// Node has no browser, so this cannot click anything; it proves the greeting,
// the KPI tiles, the forecast and the four boxes render without throwing and
// carry the words, links and ids the plan asks for.

let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/dashboard",
  useSearchParams: () => new URLSearchParams(search),
}));

const { DashboardView } = await import("@/components/sales/dashboard-view");

const NOW = "2026-11-05T15:00:00.000Z";

function dashboard(extra: Partial<DashboardData> = {}): DashboardData {
  return {
    scope: "everyone",
    canSeeEveryone: true,
    viewerName: "Ben Example",
    members: [
      { id: "u1", name: "Ben Example" },
      { id: "u2", name: "Dana Example" },
    ],
    kpis: {
      openDeals: 3,
      pipelineCents: 4320000,
      wonThisMonthCents: 3240000,
      wonThisMonthCount: 2,
      overdueActivities: 2,
    },
    forecast: { thisMonthCents: 432000, nextMonthCents: 0, noCloseDateCount: 2 },
    today: [
      {
        id: "a1",
        type: "CALL",
        subject: "Follow-up call",
        dueAt: endOfDay("2026-11-02").toISOString(),
        hasTime: false,
        ownerId: "u1",
        parent: { kind: "deal", id: "d1", title: "Oak Creek Dental" },
      },
      {
        id: "a2",
        type: "CALL",
        subject: "First call",
        dueAt: endOfDay("2026-11-05").toISOString(),
        hasTime: false,
        ownerId: "u2",
        parent: { kind: "lead", id: "l2", title: "Crestview Dental" },
      },
    ],
    todayCount: 5,
    noNextStep: [
      {
        kind: "deal",
        id: "d2",
        title: "Bright Smile Dental",
        since: "2026-10-27T15:00:00.000Z",
        stageName: "Demo Complete",
        ownerId: "u2",
      },
      { kind: "lead", id: "l1", title: "Maple Grove Dental", since: "2026-11-02T15:00:00.000Z", stageName: null, ownerId: "u1" },
    ],
    noNextStepCount: 12,
    followUp: [
      {
        id: "d3",
        title: "Pine Hill Dental",
        pipelineName: "Direct Mail",
        valueCents: 1440000,
        mrrCents: 120000,
        ownerId: "u1",
        next: { type: "CALL", subject: "Check in", dueAt: endOfDay("2026-11-09").toISOString(), hasTime: false },
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
        dealTitle: "Oak Creek Dental",
        actorName: "Ben E.",
      },
    ],
    ...extra,
  };
}

/** The server HTML, without the comment markers React puts between adjacent text pieces. */
function render(data: DashboardData) {
  return renderToString(createElement(DashboardView, { data, now: NOW })).replaceAll("<!-- -->", "");
}

/** Every link's attributes, `&amp;` read back as `&`. */
function anchors(html: string): Record<string, string>[] {
  return [...html.matchAll(/<a\s([^>]*)>/g)].map((match) =>
    Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2].replaceAll("&amp;", "&")])),
  );
}

/** The class list of the element whose whole text is `text`. */
function classOf(html: string, text: string): string[] {
  const escaped = text.replace(/[$.*+?^()[\]{}|\\]/g, "\\$&");
  const match = new RegExp(`class="([^"]*)"[^>]*>${escaped}<`).exec(html);
  expect(match, text).not.toBeNull();
  return match![1].split(/\s+/);
}

/** The HTML of the box whose heading is `heading`, up to the next box. */
function box(html: string, heading: string): string {
  const start = html.indexOf(`${heading}</h2>`);
  expect(start, heading).toBeGreaterThan(-1);
  const next = html.indexOf("</h2>", start + heading.length + 5);
  return html.slice(start, next === -1 ? undefined : next);
}

beforeEach(() => {
  search = "";
});

describe("Sales dashboard (server render)", () => {
  it("greets the viewer and dates the page", () => {
    const html = render(dashboard());
    expect(html).toMatch(/<h1[^>]*>Good morning, Ben<\/h1>/);
    expect(html).toContain("Thursday, Nov 5. Here is what needs you today.");
    expect(html).toContain("Everyone");
    expect(html).toContain("Just me");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Everyone<\/button>/);
    expect(html).toContain('aria-label="Keyboard shortcuts"');
  });

  it("presses Just me when the dashboard is on it", () => {
    const html = render(dashboard({ scope: "mine" }));
    expect(html).toMatch(/aria-pressed="true"[^>]*>Just me<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Everyone<\/button>/);
  });

  it("shows the four KPI tiles with their words", () => {
    const html = render(dashboard());
    for (const label of ["Open deals", "Pipeline value", "Won this month", "Overdue activities"]) {
      expect(html).toContain(`>${label}</dt>`);
    }
    for (const caption of ["sales pipelines", "open, all stages", "2 deals", "need a call or reschedule"]) {
      expect(html).toContain(`>${caption}</dd>`);
    }
    expect(html).toContain(">$43,200</dd>");
    expect(html).toContain(">$32,400</dd>");

    const alert = /data-alert="true"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    expect(alert).not.toBeNull();
    expect(alert![1]).toContain("Overdue activities");
    expect(alert![1]).toContain("need a call or reschedule");
    expect(html.match(/data-alert="true"/g)).toHaveLength(1);
  });

  it("lets a long value wrap inside its tile instead of widening the page", () => {
    const html = render(dashboard({ kpis: { ...dashboard().kpis, pipelineCents: 1234567800 } }));
    for (const value of ["3", "$12,345,678", "$32,400", "2"]) {
      const classes = classOf(html, value);
      expect(classes, value).toEqual(expect.arrayContaining(["min-w-0", "[overflow-wrap:anywhere]", "tabular-nums"]));
    }
  });

  it("says the overdue count in red and in words, and calms down at zero", () => {
    const html = render(dashboard());
    const overdue = classOf(html, "2");
    expect(overdue).toContain("text-destructive");
    for (const theme of ["light", "dark"] as const) {
      expect(contrast(utilityColour("text-destructive", theme)!, token("card", theme))).toBeGreaterThanOrEqual(4.5);
    }

    const calm = render(dashboard({ kpis: { ...dashboard().kpis, overdueActivities: 0 } }));
    expect(calm).not.toContain('data-alert="true"');
    expect(calm).toContain(">all caught up</dd>");
    expect(classOf(calm, "0")).not.toContain("text-destructive");
  });

  it("shows the forecast weighted by win chance", () => {
    const html = render(dashboard());
    const forecast = box(html, "Expected to close");
    expect(forecast).toContain("by expected close date");
    expect(forecast).toContain("This month");
    expect(forecast).toContain("November");
    expect(forecast).toContain("$4,320");
    expect(forecast).toContain("Next month");
    expect(forecast).toContain("December");
    expect(forecast).toContain("$0");
    expect(forecast).toContain("No close date: 2 deals");
    expect(forecast).toContain("Set Expected close in a deal&#x27;s Details to count it here.");
    expect(forecast).toContain("Each deal counts at its stage&#x27;s win chance, so a $10,000 deal at 70% adds $7,000. Lost stages count as 0%.");
    expect(forecast).not.toContain("Set an expected close date on a deal to see it here.");
  });

  it("with nothing expected this month or next, says how to fill the forecast", () => {
    const html = render(dashboard({ forecast: { thisMonthCents: 0, nextMonthCents: 0, noCloseDateCount: 2 } }));
    const forecast = box(html, "Expected to close");
    expect(forecast).toContain("Set an expected close date on a deal to see it here.");
    // The hint stands in for the cell's own nudge, so the box does not say it twice.
    expect(forecast).not.toContain("to count it here.");
    expect(forecast).toContain("No close date: 2 deals");
  });

  it("lists today's and overdue work with a count, View all, and Lead on lead rows", () => {
    const html = render(dashboard());
    const today = box(html, "Today and overdue");
    expect(today).toMatch(/>5<\/span>/);
    expect(today).toContain("Follow-up call");
    expect(today).toContain("Oak Creek Dental · overdue 3d");
    expect(today).toContain("Crestview Dental · today");
    expect(today).toMatch(/>Lead<\/span>/);
    expect(today.match(/>Lead<\/span>/g)).toHaveLength(1);
    expect(today).toContain('aria-label="Owner: Ben Example"');
    expect(today).toContain('aria-label="Owner: Dana Example"');

    const links = anchors(today);
    expect(links).toEqual(expect.arrayContaining([expect.objectContaining({ href: "/sales/dashboard?deal=d1", "data-deal-id": "d1" })]));
    expect(links).toEqual(expect.arrayContaining([expect.objectContaining({ href: "/sales/dashboard?lead=l2", "data-lead-id": "l2" })]));
    expect(links).toEqual(expect.arrayContaining([expect.objectContaining({ href: viewAllHrefs("everyone", "direct-mail").today })]));
  });

  it("lists deals and leads with no next step, the lead marked Lead, with links to see them all", () => {
    const html = render(dashboard());
    const stalled = box(html, "No next step");
    expect(stalled).toMatch(/>12<\/span>/);
    expect(stalled).toContain("Demo Complete · 9 days in stage");
    expect(stalled).toContain("Lead · 3 days old");
    // The caption already says "Lead": no second marker on the row.
    expect(stalled).not.toMatch(/>Lead<\/span>/);

    const links = anchors(stalled);
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "/sales/dashboard?deal=d2", "data-deal-id": "d2" }),
        expect.objectContaining({ href: "/sales/dashboard?lead=l1", "data-lead-id": "l1" }),
        expect.objectContaining({ href: viewAllHrefs("everyone", "direct-mail").noNextStep }),
        expect.objectContaining({ href: "/sales/leads" }),
      ]),
    );
    expect(stalled).toContain("See all:");
    expect(stalled).toContain(">Deals with no next step</a>");
    expect(stalled).toContain(">Leads Inbox</a>");
  });

  it("lists deals in Follow-Up with their pipeline, value and next step", () => {
    const html = render(dashboard());
    const followUp = box(html, "Deals in Follow-Up");
    expect(followUp).toContain("Pine Hill Dental");
    expect(followUp).toContain("Direct Mail · $14,400 · $1,200/mo");
    expect(followUp).toContain("Nov 9");
    const links = anchors(followUp);
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "/sales/dashboard?deal=d3", "data-deal-id": "d3" }),
        expect.objectContaining({ href: viewAllHrefs("everyone", "direct-mail").followUp! }),
      ]),
    );
    expect(followUp).toContain(">View all</a>");
  });

  it("has no Follow-Up View all when no pipeline has a Follow-Up stage", () => {
    const html = render(dashboard({ followUpPipelineKey: null }));
    const followUp = box(html, "Deals in Follow-Up");
    expect(followUp).not.toContain("View all");
    expect(followUp).toContain("Pine Hill Dental");
  });

  it("lists the newest history lines on deals, each opening its deal", () => {
    const html = render(dashboard());
    const recent = box(html, "Recent activity");
    expect(recent).toContain("Moved to Proposal Sent");
    expect(recent).toContain("Oak Creek Dental · Today · Ben E.");
    expect(anchors(recent)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: "/sales/dashboard?deal=d1",
          "data-deal-id": "d1",
          "aria-label": "Oak Creek Dental: Moved to Proposal Sent",
        }),
      ]),
    );
    expect(recent).not.toContain("View all");
  });

  it("keeps Just me on every View all link and keeps other params on the panel links", () => {
    search = "scope=mine";
    const html = render(dashboard({ scope: "mine" }));
    const hrefs = viewAllHrefs("mine", "direct-mail");
    const links = anchors(html).map((link) => link.href);
    expect(links).toEqual(
      expect.arrayContaining([hrefs.today, hrefs.noNextStep, hrefs.followUp, "/sales/leads?scope=mine", "/sales/dashboard?scope=mine&lead=l1"]),
    );
  });

  it("an empty box explains itself and offers a next move", () => {
    const html = render(dashboard({ today: [], todayCount: 0, noNextStep: [], noNextStepCount: 0, followUp: [], recent: [] }));
    for (const [heading, key] of [
      ["Today and overdue", "today"],
      ["No next step", "noNextStep"],
      ["Deals in Follow-Up", "followUp"],
      ["Recent activity", "recent"],
    ] as const) {
      const empty = dashboardEmpty(key);
      const section = box(html, heading);
      expect(section).toContain(empty.title);
      expect(section).toContain(empty.description);
      expect(anchors(section)).toEqual(expect.arrayContaining([expect.objectContaining({ href: empty.action.href })]));
      expect(section).toContain(`>${empty.action.label}</a>`);
      // The empty state's own link is the way on; no second "View all" or "See all".
      expect(section).not.toContain("View all");
      expect(section).not.toContain("See all:");
    }
    expect(box(html, "Today and overdue")).toMatch(/>0<\/span>/);
  });

  it("Recent's empty line speaks of your own deals on Just me and for someone who sees only their own", () => {
    const mine = dashboardEmpty("recent", true);
    const onJustMe = render(dashboard({ scope: "mine", recent: [] }));
    expect(box(onJustMe, "Recent activity")).toContain(mine.title);
    const ownOnly = render(dashboard({ canSeeEveryone: false, recent: [] }));
    expect(box(ownOnly, "Recent activity")).toContain(mine.title);
    expect(box(ownOnly, "Recent activity")).toContain(mine.description);
    const everyone = render(dashboard({ recent: [] }));
    expect(box(everyone, "Recent activity")).toContain(dashboardEmpty("recent").description);
  });

  it("hides Everyone / Just me from someone who sees only their own deals", () => {
    const html = render(dashboard({ canSeeEveryone: false }));
    expect(html).not.toContain("Just me");
    expect(html).not.toContain(">Everyone</button>");
    expect(html).toContain('aria-label="Keyboard shortcuts"');
  });

  it("on phones puts the to-do boxes first and the forecast after them", () => {
    const html = render(dashboard());
    const order = (heading: string) => {
      const at = html.indexOf(`${heading}</h2>`);
      const open = html.lastIndexOf("<section", at);
      return /class="([^"]*)"/.exec(html.slice(open))![1].split(/\s+/).find((name) => name.startsWith("max-sm:order-"));
    };
    expect(order("Today and overdue")).toBe("max-sm:order-1");
    expect(order("No next step")).toBe("max-sm:order-2");
    expect(order("Expected to close")).toBe("max-sm:order-3");
    expect(order("Deals in Follow-Up")).toBe("max-sm:order-4");
    expect(order("Recent activity")).toBe("max-sm:order-4");
  });

  it("View all and See all links read at AA on the card in both themes", () => {
    const html = render(dashboard());
    const link = /<a\s[^>]*class="([^"]*)"[^>]*>View all<\/a>/.exec(html);
    expect(link).not.toBeNull();
    const classes = link![1].split(/\s+/);
    const light = classes.find((name) => /^text-[a-z]+-\d+$/.test(name) || name === "text-accent-foreground")!;
    const dark = classes.find((name) => name.startsWith("dark:text-"))?.slice("dark:".length) ?? light;
    expect(contrast(utilityColour(light, "light")!, token("card", "light"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(utilityColour(dark, "dark")!, token("card", "dark"))).toBeGreaterThanOrEqual(4.5);
  });
});
