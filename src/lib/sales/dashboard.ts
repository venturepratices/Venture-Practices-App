import type { Prisma } from "@/generated/prisma/client";
import type { SalesActivityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import { activityParentWhere } from "@/lib/sales/activities-page";
import { loadSalesMembers, type SalesMemberOption } from "@/lib/sales/board";
import {
  BOARD_PIPELINE_KINDS,
  DASHBOARD_LIST_ROWS,
  FOLLOW_UP_STAGE_KEY,
  RECENT_ACTIVITY_ROWS,
  RECENT_FEED_PAGES,
  RECENT_FEED_SCAN,
} from "@/lib/sales/constants";
import { shortName } from "@/lib/sales/format";
import { describeAuditRow, type TimelineIcon } from "@/lib/sales/timeline";
import { addMonthsToDateString, dateInputValue, endOfDay, startOfDay } from "@/lib/utils";

// What the Sales dashboard shows (spec 7.9, Decisions 25 and 26): the KPI tiles
// over the Sales and Consulting pipelines, the "Expected to close" forecast,
// and four boxes: today's and overdue work, deals and leads with no next step,
// deals in Follow-Up, and the newest history lines on deals the viewer may
// see. "Everyone / Just me" follows the deal rules (`dealOwnerWhere`); an
// activity is listed only through a deal or lead its viewer may see, and on
// Just me only when the viewer owns it. Days and months are read in app time
// (Eastern). Every query starts at once; lists read only the columns a row
// shows (never a person's email or phone) and stop at 8 rows. Plain
// serializable values, dates as ISO strings.

type DashboardDb = Pick<
  typeof prisma,
  "salesDeal" | "salesLead" | "salesActivity" | "salesStage" | "salesAuditLog" | "teamMember"
>;

export type DashboardScope = "everyone" | "mine";

/** The deal or lead an activity is on, as a dashboard row opens it. */
export type DashboardParent = { kind: "deal" | "lead"; id: string; title: string };

export type DashboardActivity = {
  id: string;
  type: SalesActivityType;
  subject: string;
  dueAt: string;
  hasTime: boolean;
  ownerId: string;
  parent: DashboardParent;
};

/** An open deal or lead with no open activity: `since` is when the deal entered its stage, or when the lead came in. */
export type DashboardStalled = {
  kind: "deal" | "lead";
  id: string;
  title: string;
  since: string;
  /** The deal's stage; null for a lead. */
  stageName: string | null;
  ownerId: string;
};

export type DashboardFollowUp = {
  id: string;
  title: string;
  pipelineName: string;
  valueCents: number;
  mrrCents: number;
  ownerId: string;
  /** The earliest open activity, or null when nothing is scheduled. */
  next: { type: SalesActivityType; subject: string; dueAt: string; hasTime: boolean } | null;
};

/** One history line on a deal, worded as the deal panel's History words it. */
export type DashboardRecent = {
  id: string;
  at: string;
  icon: TimelineIcon;
  text: string;
  dealId: string;
  dealTitle: string;
  /** First name and last initial; null for a rule, or someone no longer on the team. */
  actorName: string | null;
};

export type DashboardData = {
  scope: DashboardScope;
  /** False for someone set to see only their own deals: the Everyone / Just me switch is hidden. */
  canSeeEveryone: boolean;
  /** The viewer's name as stored; the greeting uses its first word. Empty when the row is gone. */
  viewerName: string;
  members: SalesMemberOption[];
  kpis: {
    openDeals: number;
    /** Raw (not weighted) value of the open deals. */
    pipelineCents: number;
    wonThisMonthCents: number;
    wonThisMonthCount: number;
    /** Not done and due before today (app time), on open deals and open leads. */
    overdueActivities: number;
  };
  /** Weighted by each stage's win chance; lost stages count nothing. */
  forecast: { thisMonthCents: number; nextMonthCents: number; noCloseDateCount: number };
  today: DashboardActivity[];
  /** Every activity due today or overdue, not just the rows shown. */
  todayCount: number;
  noNextStep: DashboardStalled[];
  /** Deals and leads with no next step, not just the rows shown. */
  noNextStepCount: number;
  followUp: DashboardFollowUp[];
  /** The first Sales pipeline (by position) with a live Follow-Up stage, for the box's "View all"; null when none has one. */
  followUpPipelineKey: string | null;
  recent: DashboardRecent[];
};

const OPEN_ACTIVITY = { doneAt: null, archivedAt: null } as const;
const MINE = "mine";

type RawParams = Record<string, string | string[] | undefined>;

/** "Just me" when the URL says `scope=mine`; anything else is Everyone. */
export function parseDashboardScope(params: RawParams): DashboardScope {
  const scope = Array.isArray(params.scope) ? params.scope[0] : params.scope;
  return scope === MINE ? "mine" : "everyone";
}

/** App-time (Eastern) midnight on the 1st of this month, next month and the month after. */
export function appMonthBounds(now: Date): { thisMonth: Date; nextMonth: Date; monthAfter: Date } {
  const firstOfMonth = `${dateInputValue(now).slice(0, 7)}-01`;
  return {
    thisMonth: startOfDay(firstOfMonth),
    nextMonth: startOfDay(addMonthsToDateString(firstOfMonth, 1)),
    monthAfter: startOfDay(addMonthsToDateString(firstOfMonth, 2)),
  };
}

/**
 * The weighted value of open deals grouped by stage: each stage's total times
 * its win chance, rounded to whole cents per stage. A lost stage, or a stage
 * not in `stages`, counts nothing.
 */
export function weightedCents(
  groups: { stageId: string; sumCents: number }[],
  stages: Map<string, { probability: number; isLost: boolean }>,
): number {
  return groups.reduce((total, group) => {
    const stage = stages.get(group.stageId);
    if (!stage || stage.isLost) return total;
    return total + Math.round((group.sumCents * stage.probability) / 100);
  }, 0);
}

const ACTIVITY_SELECT = {
  id: true,
  type: true,
  subject: true,
  dueAt: true,
  hasTime: true,
  ownerId: true,
  deal: { select: { id: true, title: true } },
  lead: { select: { id: true, title: true } },
} satisfies Prisma.SalesActivitySelect;

const STAGE_SELECT = {
  id: true,
  key: true,
  probability: true,
  isLost: true,
  archivedAt: true,
  pipeline: { select: { key: true, position: true } },
} satisfies Prisma.SalesStageSelect;

const AUDIT_SELECT = {
  id: true,
  at: true,
  entityType: true,
  entityId: true,
  actorType: true,
  actorId: true,
  action: true,
  before: true,
  after: true,
} satisfies Prisma.SalesAuditLogSelect;

type AuditRow = Prisma.SalesAuditLogGetPayload<{ select: typeof AUDIT_SELECT }>;

/** The `ownerId` a stored history payload names, else null (the rows are stored JSON, read defensively). */
function payloadOwnerId(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const ownerId = (value as Record<string, unknown>).ownerId;
  return typeof ownerId === "string" && ownerId !== "" ? ownerId : null;
}

/**
 * The newest RECENT_ACTIVITY_ROWS history rows on deals this person may see
 * (`owner`): pages of RECENT_FEED_SCAN rows, newest first, each page's deals
 * looked up once, stopping once enough are found, at a short page, or after
 * RECENT_FEED_PAGES pages (a viewer who sees few deals never scans the whole
 * log). Names come from one lookup at the end.
 */
async function loadRecent(db: DashboardDb, owner: { ownerId?: string }): Promise<DashboardRecent[]> {
  const found: { row: AuditRow; dealTitle: string }[] = [];
  let after: { at: Date; id: string } | null = null;

  for (let page = 0; page < RECENT_FEED_PAGES && found.length < RECENT_ACTIVITY_ROWS; page++) {
    const where: Prisma.SalesAuditLogWhereInput = after
      ? { entityType: "SalesDeal", OR: [{ at: { lt: after.at } }, { at: after.at, id: { lt: after.id } }] }
      : { entityType: "SalesDeal" };
    const rows = await db.salesAuditLog.findMany({
      where,
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: RECENT_FEED_SCAN,
      select: AUDIT_SELECT,
    });
    if (rows.length === 0) break;

    const deals = await db.salesDeal.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.entityId))] }, archivedAt: null, ...owner },
      select: { id: true, title: true },
    });
    const titles = new Map(deals.map((deal) => [deal.id, deal.title]));
    for (const row of rows) {
      const dealTitle = titles.get(row.entityId);
      if (dealTitle === undefined) continue;
      found.push({ row, dealTitle });
      if (found.length === RECENT_ACTIVITY_ROWS) break;
    }

    if (rows.length < RECENT_FEED_SCAN) break;
    const last = rows[rows.length - 1];
    after = { at: last.at, id: last.id };
  }
  if (found.length === 0) return [];

  // Who acted, and the new owner an "Owner changed to ..." line names.
  const personIds = new Set<string>();
  for (const { row } of found) {
    if (row.actorId) personIds.add(row.actorId);
    const newOwner = row.action === "owner_changed" ? payloadOwnerId(row.after) : null;
    if (newOwner) personIds.add(newOwner);
  }
  const people =
    personIds.size > 0
      ? await db.teamMember.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, name: true } })
      : [];
  const names = new Map(people.map((person) => [person.id, person.name]));

  return found.map(({ row, dealTitle }) => {
    const actorFullName = row.actorId ? names.get(row.actorId) : undefined;
    return {
      id: row.id,
      at: row.at.toISOString(),
      ...describeAuditRow(row, names),
      dealId: row.entityId,
      dealTitle,
      actorName: actorFullName ? shortName(actorFullName) : null,
    };
  });
}

/** The dashboard for this person and scope, with every query started at once. */
export async function loadDashboard(
  actor: SalesActor,
  scope: DashboardScope,
  now: Date,
  db: DashboardDb = prisma,
): Promise<DashboardData> {
  const today = dateInputValue(now);
  const { thisMonth, nextMonth, monthAfter } = appMonthBounds(now);
  const owner = dealOwnerWhere(actor, scope);
  const boardPipelines = { kind: { in: [...BOARD_PIPELINE_KINDS] }, archivedAt: null };
  // Open deals in the Sales and Consulting pipelines this person may see on this scope.
  const dealScope = { archivedAt: null, status: "OPEN", pipeline: boardPipelines, ...owner } satisfies Prisma.SalesDealWhereInput;
  // Work to do through an open deal or lead the person may see; on Just me, only their own.
  const toDo = {
    ...OPEN_ACTIVITY,
    ...(scope === "mine" ? { ownerId: actor.userId } : {}),
    ...activityParentWhere(actor, false),
  } satisfies Prisma.SalesActivityWhereInput;
  const dueByToday = { ...toDo, dueAt: { lte: endOfDay(today) } };
  const stalledDeals = { ...dealScope, activities: { none: OPEN_ACTIVITY } } satisfies Prisma.SalesDealWhereInput;
  const stalledLeads = {
    status: "OPEN",
    archivedAt: null,
    ...owner,
    activities: { none: OPEN_ACTIVITY },
  } satisfies Prisma.SalesLeadWhereInput;

  const [
    viewer,
    members,
    open,
    won,
    overdueActivities,
    todayRows,
    todayCount,
    stalledDealRows,
    stalledDealCount,
    stalledLeadRows,
    stalledLeadCount,
    followUpRows,
    stages,
    thisMonthGroups,
    nextMonthGroups,
    noCloseDateCount,
    recent,
  ] = await Promise.all([
    db.teamMember.findUnique({ where: { id: actor.userId }, select: { name: true } }),
    loadSalesMembers(db),
    db.salesDeal.aggregate({ where: dealScope, _count: { _all: true }, _sum: { valueCents: true } }),
    db.salesDeal.aggregate({
      where: { archivedAt: null, status: "WON", wonAt: { gte: thisMonth, lt: nextMonth }, pipeline: boardPipelines, ...owner },
      _count: { _all: true },
      _sum: { valueCents: true },
    }),
    db.salesActivity.count({ where: { ...toDo, dueAt: { lt: startOfDay(today) } } }),
    db.salesActivity.findMany({
      where: dueByToday,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: DASHBOARD_LIST_ROWS,
      select: ACTIVITY_SELECT,
    }),
    db.salesActivity.count({ where: dueByToday }),
    db.salesDeal.findMany({
      where: stalledDeals,
      orderBy: [{ stageEnteredAt: "asc" }, { id: "asc" }],
      take: DASHBOARD_LIST_ROWS,
      select: { id: true, title: true, stageEnteredAt: true, ownerId: true, stage: { select: { name: true } } },
    }),
    db.salesDeal.count({ where: stalledDeals }),
    db.salesLead.findMany({
      where: stalledLeads,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: DASHBOARD_LIST_ROWS,
      select: { id: true, title: true, createdAt: true, ownerId: true },
    }),
    db.salesLead.count({ where: stalledLeads }),
    db.salesDeal.findMany({
      where: { ...dealScope, stage: { key: FOLLOW_UP_STAGE_KEY } },
      orderBy: [{ stageEnteredAt: "desc" }, { id: "desc" }],
      take: DASHBOARD_LIST_ROWS,
      select: {
        id: true,
        title: true,
        valueCents: true,
        mrrCents: true,
        ownerId: true,
        pipeline: { select: { name: true } },
        activities: {
          where: OPEN_ACTIVITY,
          orderBy: [{ dueAt: "asc" }, { id: "asc" }],
          take: 1,
          select: { type: true, subject: true, dueAt: true, hasTime: true },
        },
      },
    }),
    // One read gives both the win chances for the forecast and the Follow-Up link.
    db.salesStage.findMany({ where: { pipeline: boardPipelines }, select: STAGE_SELECT }),
    db.salesDeal.groupBy({
      by: ["stageId"],
      where: { ...dealScope, expectedCloseDate: { gte: thisMonth, lt: nextMonth } },
      _sum: { valueCents: true },
    }),
    db.salesDeal.groupBy({
      by: ["stageId"],
      where: { ...dealScope, expectedCloseDate: { gte: nextMonth, lt: monthAfter } },
      _sum: { valueCents: true },
    }),
    db.salesDeal.count({ where: { ...dealScope, expectedCloseDate: null } }),
    loadRecent(db, owner),
  ]);

  const chances = new Map(stages.map((stage) => [stage.id, { probability: stage.probability, isLost: stage.isLost }]));
  const weighted = (groups: { stageId: string; _sum: { valueCents: number | null } }[]) =>
    weightedCents(
      groups.map((group) => ({ stageId: group.stageId, sumCents: group._sum.valueCents ?? 0 })),
      chances,
    );

  let followUpPipeline: { key: string; position: number } | null = null;
  for (const stage of stages) {
    if (stage.key !== FOLLOW_UP_STAGE_KEY || stage.archivedAt !== null) continue;
    if (!followUpPipeline || stage.pipeline.position < followUpPipeline.position) followUpPipeline = stage.pipeline;
  }

  const todayList: DashboardActivity[] = todayRows.flatMap((row) => {
    // The filter lets through only activities on a deal or a lead; a deal's comes first (a converted lead's moved call).
    const parent: DashboardParent | null = row.deal
      ? { kind: "deal", ...row.deal }
      : row.lead
        ? { kind: "lead", ...row.lead }
        : null;
    if (!parent) return [];
    return [
      {
        id: row.id,
        type: row.type,
        subject: row.subject,
        dueAt: row.dueAt.toISOString(),
        hasTime: row.hasTime,
        ownerId: row.ownerId,
        parent,
      },
    ];
  });

  // Oldest first across deals and leads (a deal's time in its stage, a lead's age), 8 at most.
  const noNextStep: DashboardStalled[] = [
    ...stalledDealRows.map((deal) => ({
      kind: "deal" as const,
      id: deal.id,
      title: deal.title,
      since: deal.stageEnteredAt,
      stageName: deal.stage.name,
      ownerId: deal.ownerId,
    })),
    ...stalledLeadRows.map((lead) => ({
      kind: "lead" as const,
      id: lead.id,
      title: lead.title,
      since: lead.createdAt,
      stageName: null,
      ownerId: lead.ownerId,
    })),
  ]
    .sort((a, b) => a.since.getTime() - b.since.getTime())
    .slice(0, DASHBOARD_LIST_ROWS)
    .map((row) => ({ ...row, since: row.since.toISOString() }));

  return {
    scope,
    canSeeEveryone: actor.isAdmin || actor.seesAllDeals,
    viewerName: viewer?.name ?? "",
    members,
    kpis: {
      openDeals: open._count._all,
      pipelineCents: open._sum.valueCents ?? 0,
      wonThisMonthCents: won._sum.valueCents ?? 0,
      wonThisMonthCount: won._count._all,
      overdueActivities,
    },
    forecast: {
      thisMonthCents: weighted(thisMonthGroups),
      nextMonthCents: weighted(nextMonthGroups),
      noCloseDateCount,
    },
    today: todayList,
    todayCount,
    noNextStep,
    noNextStepCount: stalledDealCount + stalledLeadCount,
    followUp: followUpRows.map((deal) => {
      const next = deal.activities[0];
      return {
        id: deal.id,
        title: deal.title,
        pipelineName: deal.pipeline.name,
        valueCents: deal.valueCents,
        mrrCents: deal.mrrCents,
        ownerId: deal.ownerId,
        next: next ? { type: next.type, subject: next.subject, dueAt: next.dueAt.toISOString(), hasTime: next.hasTime } : null,
      };
    }),
    followUpPipelineKey: followUpPipeline?.key ?? null,
    recent,
  };
}
