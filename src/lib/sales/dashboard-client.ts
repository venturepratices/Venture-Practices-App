import { activitiesQueryToSearch } from "@/lib/sales/activities-query";
import { boardQueryToSearch, type BoardQuery } from "@/lib/sales/board-query";
import { FOLLOW_UP_STAGE_KEY } from "@/lib/sales/constants";
import type { DashboardActivity, DashboardData, DashboardFollowUp, DashboardScope, DashboardStalled } from "@/lib/sales/dashboard";
import { daysInStage, formatMoney } from "@/lib/sales/format";
import { leadsQueryToSearch } from "@/lib/sales/leads-query";
import { addMonthsToDateString, APP_TIME_ZONE, dateInputValue, formatDate, startOfDay } from "@/lib/utils";

// The Sales dashboard's words and links (Decisions 25 and 26, Mockup v2
// `viewHome`). Pure, and client-safe: the server module dashboard.ts is read
// for its types only. Hours, days and months are read in app time (Eastern),
// so the greeting, the date line and the forecast's month names match what the
// server counted.

/** 0 to 23 in app time. */
const APP_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, hour: "numeric", hourCycle: "h23" });

/** "1 day", "2 days", "0 days". */
function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "1 deal", "2 deals", "0 deals". */
export function dealCount(n: number): string {
  return count(n, "deal");
}

/** "Good morning" before noon, "Good afternoon" before 5 PM, else "Good evening" (app time), then the first word of the name. */
export function greeting(now: Date, fullName: string): string {
  const hour = Number(APP_HOUR.format(now));
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const first = fullName.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

/** "Thursday, Nov 5. Here is what needs you today." */
export function dashboardDateLine(now: Date): string {
  return `${formatDate(now, { weekday: "long", month: "short", day: "numeric" })}. Here is what needs you today.`;
}

/** Under the Overdue activities tile: the count in words, so red is never the only signal. */
export function overdueCaption(n: number): string {
  return n === 0 ? "all caught up" : "need a call or reschedule";
}

/** Under Won this month: how many deals the value is. */
export function wonCaption(n: number): string {
  return dealCount(n);
}

/** The forecast's third cell, read as one phrase. */
export function noCloseDateLine(n: number): string {
  return `No close date: ${dealCount(n)}`;
}

/** The names of this month and next, in app time ("November", "December"). */
export function forecastMonths(now: Date): { thisMonth: string; nextMonth: string } {
  const firstOfMonth = `${dateInputValue(now).slice(0, 7)}-01`;
  const name = (day: string) => formatDate(startOfDay(day), { month: "long" });
  return { thisMonth: name(firstOfMonth), nextMonth: name(addMonthsToDateString(firstOfMonth, 1)) };
}

/** With nothing weighted into this month or next, how to fill the forecast; null otherwise. */
export function forecastHint(forecast: DashboardData["forecast"]): string | null {
  return forecast.thisMonthCents === 0 && forecast.nextMonthCents === 0
    ? "Set an expected close date on a deal to see it here."
    : null;
}

/** "Demo Complete · 9 days in stage" for a deal; "Lead · 3 days old" (or "Lead · came in today") for a lead. */
export function stalledCaption(row: DashboardStalled, now: Date): string {
  const days = daysInStage(new Date(row.since), now);
  if (row.kind === "lead") return `Lead · ${days === 0 ? "came in today" : `${count(days, "day")} old`}`;
  return `${row.stageName ?? ""} · ${count(days, "day")} in stage`;
}

/** "Oak Creek Dental · overdue 3d", or "· today" for anything due today (app time). */
export function todayCaption(row: DashboardActivity, now: Date): string {
  const late = daysInStage(new Date(row.dueAt), now);
  return `${row.parent.title} · ${late > 0 ? `overdue ${late}d` : "today"}`;
}

/** "Direct Mail · $14,400 · $1,200/mo"; the monthly part only when there is one. */
export function followUpCaption(row: DashboardFollowUp): string {
  const monthly = row.mrrCents > 0 ? ` · ${formatMoney(row.mrrCents)}/mo` : "";
  return `${row.pipelineName} · ${formatMoney(row.valueCents)}${monthly}`;
}

export type DashboardBox = "today" | "noNextStep" | "followUp" | "recent";

type EmptyBox = { title: string; description: string; action: { label: string; href: string } };

const OPEN_DEALS = { label: "Open Deals", href: "/sales/deals" };

const EMPTY: Record<DashboardBox, EmptyBox> = {
  today: {
    title: "Nothing due. Nice.",
    description: "Calls and meetings you plan show up here.",
    action: { label: "Open Activities", href: "/sales/activities" },
  },
  noNextStep: {
    title: "Every deal and lead has a next step.",
    description: "Deals and leads with nothing planned show up here.",
    action: OPEN_DEALS,
  },
  followUp: {
    title: "None right now.",
    description: "Deals in a Follow-Up stage show up here.",
    action: OPEN_DEALS,
  },
  recent: {
    title: "Nothing yet.",
    description: "Stage moves, notes and new deals show up here.",
    action: OPEN_DEALS,
  },
};

const RECENT_MINE: EmptyBox = {
  title: "No recent changes on your deals.",
  description: "Changes to your deals show up here as they happen.",
  action: OPEN_DEALS,
};

/**
 * What an empty box says, and where it sends you. `mine`: the dashboard is on
 * Just me, or the viewer sees only their own deals; only Recent activity words
 * that differently.
 */
export function dashboardEmpty(box: DashboardBox, mine = false): EmptyBox {
  return box === "recent" && mine ? RECENT_MINE : EMPTY[box];
}

/** A Deals page URL from the board defaults plus `patch`, keys in boardQueryToSearch's order. */
function dealsHref(patch: Partial<BoardQuery>): string {
  const query: BoardQuery = {
    pipeline: null,
    view: "board",
    scope: "everyone",
    status: "open",
    next: "any",
    stage: null,
    q: "",
    cursor: null,
    ...patch,
  };
  const search = boardQueryToSearch(query);
  return search ? `/sales/deals?${search}` : "/sales/deals";
}

/**
 * Where each box's "View all" goes, keeping Just me. Activities opens on every
 * open activity (it has no "overdue and today" filter); No next step opens
 * Deals filtered to deals with none (Deals shows no leads); Follow-Up opens the
 * first Sales pipeline with a Follow-Up stage on that stage, or has no link
 * when no pipeline has one.
 */
export function viewAllHrefs(
  scope: DashboardScope,
  followUpPipelineKey: string | null,
): { today: string; noNextStep: string; followUp: string | null } {
  const activities = activitiesQueryToSearch({ when: "open", type: "all", scope, cursor: null });
  return {
    today: activities ? `/sales/activities?${activities}` : "/sales/activities",
    noNextStep: dealsHref({ scope, next: "none" }),
    followUp: followUpPipelineKey ? dealsHref({ pipeline: followUpPipelineKey, scope, stage: FOLLOW_UP_STAGE_KEY }) : null,
  };
}

/** The Leads Inbox, keeping Just me (No next step's "See all" also names leads). */
export function leadsInboxHref(scope: DashboardScope): string {
  const search = leadsQueryToSearch({ scope, q: "", cursor: null });
  return search ? `/sales/leads?${search}` : "/sales/leads";
}
