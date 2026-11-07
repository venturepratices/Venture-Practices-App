import { describe, expect, it } from "vitest";

import {
  dashboardDateLine,
  dashboardEmpty,
  dealCount,
  followUpCaption,
  forecastHint,
  forecastMonths,
  greeting,
  leadsInboxHref,
  noCloseDateLine,
  overdueCaption,
  stalledCaption,
  todayCaption,
  viewAllHrefs,
  wonCaption,
} from "@/lib/sales/dashboard-client";
import type { DashboardActivity, DashboardFollowUp, DashboardStalled } from "@/lib/sales/dashboard";
import { endOfDay } from "@/lib/utils";

// The Sales dashboard's words and links (Decisions 25 and 26), as pure
// functions the screen calls. Hours, days and months are read in app time
// (Eastern): 15:00Z on Nov 5 is 10 AM Thursday there, 04:30Z on Nov 6 is still
// 11:30 PM Thursday.

const NOW = new Date("2026-11-05T15:00:00.000Z");

const stalledDeal = (since: string): DashboardStalled => ({
  kind: "deal",
  id: "d1",
  title: "Oak Creek Dental",
  since,
  stageName: "Demo Complete",
  ownerId: "u1",
});

const stalledLead = (since: string): DashboardStalled => ({
  kind: "lead",
  id: "l1",
  title: "Crestview Dental",
  since,
  stageName: null,
  ownerId: "u1",
});

const dueOn = (dueAt: Date): DashboardActivity => ({
  id: "a1",
  type: "CALL",
  subject: "Follow-up call",
  dueAt: dueAt.toISOString(),
  hasTime: false,
  ownerId: "u1",
  parent: { kind: "deal", id: "d1", title: "Oak Creek Dental" },
});

const followUp = (mrrCents: number): DashboardFollowUp => ({
  id: "d1",
  title: "Oak Creek Dental",
  pipelineName: "Direct Mail",
  valueCents: 1440000,
  mrrCents,
  ownerId: "u1",
  next: null,
});

describe("dashboard words", () => {
  it("greets by Eastern hour and first name", () => {
    expect(greeting(new Date("2026-11-05T15:00:00Z"), "Ben Example")).toBe("Good morning, Ben");
    expect(greeting(new Date("2026-11-05T17:00:00Z"), "Ben Example")).toBe("Good afternoon, Ben");
    expect(greeting(new Date("2026-11-05T22:00:00Z"), "Ben Example")).toBe("Good evening, Ben");
    expect(greeting(new Date("2026-11-06T04:30:00Z"), "Ben Example")).toBe("Good evening, Ben");
    expect(greeting(new Date("2026-11-05T15:00:00Z"), "  DJ ")).toBe("Good morning, DJ");
    expect(greeting(new Date("2026-11-05T15:00:00Z"), "")).toBe("Good morning");
  });

  it("turns at noon and at 5 PM Eastern, not UTC", () => {
    // 11:59 AM and 4:59 PM Eastern are still the earlier greeting; midnight Eastern is morning.
    expect(greeting(new Date("2026-11-05T16:59:00Z"), "Ben Example")).toBe("Good morning, Ben");
    expect(greeting(new Date("2026-11-05T21:59:00Z"), "Ben Example")).toBe("Good afternoon, Ben");
    expect(greeting(new Date("2026-11-06T05:00:00Z"), "Ben Example")).toBe("Good morning, Ben");
  });

  it("dates the page in Eastern time", () => {
    expect(dashboardDateLine(new Date("2026-11-05T15:00:00Z"))).toBe("Thursday, Nov 5. Here is what needs you today.");
    expect(dashboardDateLine(new Date("2026-11-06T04:30:00Z"))).toBe("Thursday, Nov 5. Here is what needs you today.");
  });

  it("captions tiles in words", () => {
    expect(overdueCaption(0)).toBe("all caught up");
    expect(overdueCaption(2)).toBe("need a call or reschedule");
    expect(wonCaption(1)).toBe("1 deal");
    expect(wonCaption(0)).toBe("0 deals");
    expect(wonCaption(2)).toBe("2 deals");
    expect(dealCount(0)).toBe("0 deals");
    expect(dealCount(1)).toBe("1 deal");
    expect(dealCount(2)).toBe("2 deals");
    expect(noCloseDateLine(1)).toBe("No close date: 1 deal");
    expect(noCloseDateLine(4)).toBe("No close date: 4 deals");
    expect(forecastHint({ thisMonthCents: 0, nextMonthCents: 0, noCloseDateCount: 3 })).toBe(
      "Set an expected close date on a deal to see it here.",
    );
    expect(forecastHint({ thisMonthCents: 432000, nextMonthCents: 0, noCloseDateCount: 3 })).toBeNull();
    expect(forecastHint({ thisMonthCents: 0, nextMonthCents: 1, noCloseDateCount: 0 })).toBeNull();
  });

  it("names this month and next in Eastern time", () => {
    expect(forecastMonths(NOW)).toEqual({ thisMonth: "November", nextMonth: "December" });
    // 11:30 PM Eastern on Nov 30 is Dec 1 in UTC: still November.
    expect(forecastMonths(new Date("2026-12-01T04:30:00Z"))).toEqual({ thisMonth: "November", nextMonth: "December" });
    expect(forecastMonths(new Date("2026-12-15T15:00:00Z"))).toEqual({ thisMonth: "December", nextMonth: "January" });
  });

  it("captions box rows", () => {
    expect(stalledCaption(stalledDeal("2026-10-27T15:00:00.000Z"), NOW)).toBe("Demo Complete · 9 days in stage");
    expect(stalledCaption(stalledDeal("2026-11-04T15:00:00.000Z"), NOW)).toBe("Demo Complete · 1 day in stage");
    expect(stalledCaption(stalledLead("2026-11-02T15:00:00.000Z"), NOW)).toBe("Lead · 3 days old");
    expect(stalledCaption(stalledLead("2026-11-04T15:00:00.000Z"), NOW)).toBe("Lead · 1 day old");
    // Mockup v2: a lead that came in today says so, rather than "0 days old".
    expect(stalledCaption(stalledLead("2026-11-05T13:00:00.000Z"), NOW)).toBe("Lead · came in today");

    expect(todayCaption(dueOn(endOfDay("2026-11-02")), NOW)).toBe("Oak Creek Dental · overdue 3d");
    expect(todayCaption(dueOn(endOfDay("2026-11-05")), NOW)).toBe("Oak Creek Dental · today");
    // Due at 9 AM Eastern today: still today, not overdue, until the team's day ends.
    expect(todayCaption(dueOn(new Date("2026-11-05T14:00:00Z")), NOW)).toBe("Oak Creek Dental · today");

    expect(followUpCaption(followUp(120000))).toBe("Direct Mail · $14,400 · $1,200/mo");
    expect(followUpCaption(followUp(0))).toBe("Direct Mail · $14,400");
  });

  it("every empty box explains itself and offers a next move", () => {
    expect(dashboardEmpty("today")).toEqual({
      title: "Nothing due. Nice.",
      description: "Calls and meetings you plan show up here.",
      action: { label: "Open Activities", href: "/sales/activities" },
    });
    // Mockup v2 words the title for deals and leads (P3A-X3: Mockup v2 wording wins).
    expect(dashboardEmpty("noNextStep")).toEqual({
      title: "Every deal and lead has a next step.",
      description: "Deals and leads with nothing planned show up here.",
      action: { label: "Open Deals", href: "/sales/deals" },
    });
    expect(dashboardEmpty("followUp")).toEqual({
      title: "None right now.",
      description: "Deals in a Follow-Up stage show up here.",
      action: { label: "Open Deals", href: "/sales/deals" },
    });
    // Mockup v2: "Nothing yet. Stage moves, notes and new deals show up here."
    expect(dashboardEmpty("recent")).toEqual({
      title: "Nothing yet.",
      description: "Stage moves, notes and new deals show up here.",
      action: { label: "Open Deals", href: "/sales/deals" },
    });
    expect(dashboardEmpty("recent", true)).toEqual({
      title: "No recent changes on your deals.",
      description: "Changes to your deals show up here as they happen.",
      action: { label: "Open Deals", href: "/sales/deals" },
    });
    // The other boxes ignore `mine`.
    expect(dashboardEmpty("today", true)).toEqual(dashboardEmpty("today"));
    expect(dashboardEmpty("noNextStep", true)).toEqual(dashboardEmpty("noNextStep"));
    expect(dashboardEmpty("followUp", true)).toEqual(dashboardEmpty("followUp"));
  });

  it("View all keeps Just me and the Follow-Up pipeline", () => {
    expect(viewAllHrefs("everyone", "direct-mail")).toEqual({
      today: "/sales/activities",
      noNextStep: "/sales/deals?next=none",
      followUp: "/sales/deals?pipeline=direct-mail&stage=follow-up",
    });
    // Deals keys in boardQueryToSearch order: pipeline, scope, next, stage.
    expect(viewAllHrefs("mine", "direct-mail")).toEqual({
      today: "/sales/activities?scope=mine",
      noNextStep: "/sales/deals?scope=mine&next=none",
      followUp: "/sales/deals?pipeline=direct-mail&scope=mine&stage=follow-up",
    });
    expect(viewAllHrefs("everyone", null).followUp).toBeNull();
    expect(viewAllHrefs("mine", null)).toEqual({
      today: "/sales/activities?scope=mine",
      noNextStep: "/sales/deals?scope=mine&next=none",
      followUp: null,
    });
  });

  it("the Leads Inbox link keeps Just me", () => {
    expect(leadsInboxHref("everyone")).toBe("/sales/leads");
    expect(leadsInboxHref("mine")).toBe("/sales/leads?scope=mine");
  });
});
