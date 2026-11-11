import { prisma } from "@/lib/prisma";
import { dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import { activityParentWhere } from "@/lib/sales/activities-page";
import { BOARD_PIPELINE_SELECT, isBoardPipeline, loadBoardStages, loadSalesMembers, type BoardPipeline } from "@/lib/sales/board";
import { BOARD_PIPELINE_KINDS, INSIGHTS_ROW_CAP } from "@/lib/sales/constants";
import { shortName } from "@/lib/sales/format";
import type { InsightsQuery, InsightsRange } from "@/lib/sales/insights-query";
import { addMonthsToDateString, APP_TIME_ZONE, dateInputValue, startOfDay } from "@/lib/utils";

// What the Insights page draws (spec 16.1, Decision 27): the pipeline funnel
// (open deals per stage right now), deals won per month, the average days from
// created to won per month, and activities completed per person, over the last
// 3, 6 or 12 app-time months. Months are read in app time (Eastern), so a deal
// won at 11:30 PM on Oct 31 is October's. Won deals are read once, at most
// INSIGHTS_ROW_CAP of them, and bucketed here; the funnel and the activity
// counts are grouped by the database. Plain serializable values, no raw SQL.

type InsightsDb = Pick<typeof prisma, "salesPipeline" | "salesStage" | "salesDeal" | "salesActivity" | "teamMember">;

export type InsightsData = {
  query: InsightsQuery;
  /** False for someone set to see only their own deals: the Everyone / Just me switch is hidden. */
  canSeeEveryone: boolean;
  /** The Sales and Consulting pipelines, for the funnel's picker. */
  pipelines: BoardPipeline[];
  /** The funnel's pipeline: the one the URL names, else the first; null when there is none. */
  pipeline: BoardPipeline | null;
  /** "YYYY-MM", oldest first, ending with this app-time month. */
  months: string[];
  /** Every live stage of the funnel's pipeline in board order, empty ones as 0. The range does not apply. */
  funnel: { stageId: string; name: string; count: number; valueCents: number }[];
  wonByMonth: { month: string; valueCents: number; count: number }[];
  /** Whole calendar days from created to won, averaged and rounded to a whole day; null for a month with no wins. */
  cycleByMonth: { month: string; avgDays: number | null; count: number }[];
  /** Highest first, then by name. Someone no longer in Sales is still counted, as "No longer in Sales". */
  activitiesByPerson: { ownerId: string; name: string; count: number }[];
  /** True when the won-deal read hit INSIGHTS_ROW_CAP, so the won and cycle charts may be partial. */
  capped: boolean;
};

const NO_LONGER_IN_SALES = "No longer in Sales";

/**
 * The app-time day of an instant, "YYYY-MM-DD": the same answer as
 * `dateInputValue`, from one shared formatter. A capped read holds 5,000 won
 * deals and each needs two days; building a new formatter per call (what
 * `dateInputValue` and `daysInStage` do) measured about 0.07 ms each, over a
 * second for the page, against about 0.002 ms here.
 */
const APP_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE });

/** A "YYYY-MM-DD" day as a whole day number, so two days subtract to calendar days. */
function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** The months the range covers, "YYYY-MM", oldest first, ending with this app-time month. */
export function insightMonths(now: Date, range: InsightsRange): string[] {
  const firstOfMonth = `${dateInputValue(now).slice(0, 7)}-01`;
  return Array.from({ length: range }, (_, i) => addMonthsToDateString(firstOfMonth, i - (range - 1)).slice(0, 7));
}

type Funnel = Pick<InsightsData, "pipelines" | "pipeline" | "funnel">;

/** The pipelines, the one the funnel draws, and its open deals per live stage. */
async function loadFunnel(db: InsightsDb, key: string | null, owner: { ownerId?: string }): Promise<Funnel> {
  const rows = await db.salesPipeline.findMany({
    where: { archivedAt: null, kind: { in: [...BOARD_PIPELINE_KINDS] } },
    orderBy: { position: "asc" },
    select: BOARD_PIPELINE_SELECT,
  });
  const pipelines: BoardPipeline[] = rows.filter(isBoardPipeline);
  const pipeline = pipelines.find((candidate) => candidate.key === key) ?? pipelines[0] ?? null;
  if (!pipeline) return { pipelines, pipeline: null, funnel: [] };

  const [stages, groups] = await Promise.all([
    loadBoardStages(pipeline.id, db),
    db.salesDeal.groupBy({
      by: ["stageId"],
      where: { archivedAt: null, status: "OPEN", pipelineId: pipeline.id, ...owner },
      _count: { _all: true },
      _sum: { valueCents: true },
    }),
  ]);
  const byStage = new Map(groups.map((group) => [group.stageId, group]));
  const funnel = stages.map((stage) => {
    const group = byStage.get(stage.id);
    return { stageId: stage.id, name: stage.name, count: group?._count._all ?? 0, valueCents: group?._sum.valueCents ?? 0 };
  });
  return { pipelines, pipeline, funnel };
}

/**
 * The Insights page for this person. "Everyone / Just me" follows the deal
 * rules (`dealOwnerWhere`) for deals; for activities, "Just me" means the ones
 * this person did, always on deals and leads they may see. Every query starts
 * at once.
 */
export async function loadInsights(
  actor: SalesActor,
  query: InsightsQuery,
  now: Date,
  db: InsightsDb = prisma,
): Promise<InsightsData> {
  const months = insightMonths(now, query.range);
  const since = startOfDay(`${months[0]}-01`);
  const owner = dealOwnerWhere(actor, query.scope);

  const [funnel, wonRows, doneGroups, members] = await Promise.all([
    loadFunnel(db, query.pipeline, owner),
    db.salesDeal.findMany({
      where: {
        archivedAt: null,
        status: "WON",
        wonAt: { gte: since },
        pipeline: { kind: { in: [...BOARD_PIPELINE_KINDS] } },
        ...owner,
      },
      select: { wonAt: true, createdAt: true, valueCents: true },
      orderBy: { wonAt: "asc" },
      take: INSIGHTS_ROW_CAP,
    }),
    db.salesActivity.groupBy({
      by: ["ownerId"],
      where: {
        doneAt: { gte: since },
        archivedAt: null,
        ...(query.scope === "mine" ? { ownerId: actor.userId } : {}),
        ...activityParentWhere(actor, true),
      },
      _count: { _all: true },
    }),
    loadSalesMembers(db),
  ]);

  const tally = months.map((month) => ({ month, valueCents: 0, count: 0, days: 0 }));
  const byMonth = new Map(tally.map((bucket) => [bucket.month, bucket]));
  for (const row of wonRows) {
    if (!row.wonAt) continue;
    const wonDay = APP_DAY.format(row.wonAt);
    const bucket = byMonth.get(wonDay.slice(0, 7));
    if (!bucket) continue;
    bucket.valueCents += row.valueCents;
    bucket.count += 1;
    // Whole calendar days in app time, never below 0 (as daysInStage counts them).
    bucket.days += Math.max(0, dayNumber(wonDay) - dayNumber(APP_DAY.format(row.createdAt)));
  }

  const names = new Map(members.map((member) => [member.id, shortName(member.name)]));
  const activitiesByPerson = doneGroups
    .map((group) => ({ ownerId: group.ownerId, name: names.get(group.ownerId) ?? NO_LONGER_IN_SALES, count: group._count._all }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    query,
    canSeeEveryone: actor.isAdmin || actor.seesAllDeals,
    ...funnel,
    months,
    wonByMonth: tally.map(({ month, valueCents, count }) => ({ month, valueCents, count })),
    cycleByMonth: tally.map(({ month, days, count }) => ({ month, avgDays: count > 0 ? Math.round(days / count) : null, count })),
    activitiesByPerson,
    capped: wonRows.length >= INSIGHTS_ROW_CAP,
  };
}
