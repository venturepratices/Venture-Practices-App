import type { Prisma } from "@/generated/prisma/client";
import type { SalesActivityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { dealOwnerWhere, SALES_MEMBER_WHERE, type SalesActor } from "@/lib/sales/access";
import type { BoardQuery } from "@/lib/sales/board-query";
import { BOARD_COLUMN_LIMIT, BOARD_PIPELINE_KINDS, LIST_PAGE_SIZE } from "@/lib/sales/constants";
import { dateInputValue, endOfDay, startOfDay } from "@/lib/utils";

// What the Deals page shows: the pipeline picker, the board's columns (or a
// page of the list view), the totals and the people who can own deals. Every
// value is plain and serializable (dates as ISO strings) so a server page can
// hand it straight to client components. Queries select only what a card shows
// (never a person's email or phone), are bounded, and filter on indexed columns.

type BoardDb = Pick<typeof prisma, "salesPipeline" | "salesStage" | "salesDeal" | "salesActivity" | "teamMember">;

export type BoardPipeline = { id: string; key: string; name: string; kind: "SALES" | "CONSULTING" };

export type BoardStage = {
  id: string;
  key: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
  requiresValue: boolean;
  isNoShow: boolean;
  rottingDays: number | null;
};

export type BoardCard = {
  id: string;
  title: string;
  valueCents: number;
  mrrCents: number;
  stageId: string;
  status: "OPEN" | "WON" | "LOST";
  stageEnteredAt: string;
  ownerId: string;
  personName: string | null;
  organizationName: string | null;
  /** The earliest open activity, or null when nothing is scheduled (a stalled deal). */
  next: { type: SalesActivityType; subject: string; dueAt: string } | null;
};

export type BoardColumn = { stage: BoardStage; count: number; totalCents: number; cards: BoardCard[] };
export type SalesMemberOption = { id: string; name: string };
export type DealListRow = BoardCard & { stageName: string };
export type DealListPage = { rows: DealListRow[]; nextCursor: string | null };

export type BoardPageData = {
  query: BoardQuery;
  pipelines: BoardPipeline[];
  pipeline: BoardPipeline;
  stages: BoardStage[];
  /** Board view only. */
  columns: BoardColumn[] | null;
  /** List view only: always the first page. */
  list: DealListPage | null;
  /** Every deal matching the filters, not just the ones shown. */
  totals: { count: number; valueCents: number };
  members: SalesMemberOption[];
  /** False for someone set to see only their own deals: the Everyone / Just me switch is hidden. */
  canSeeEveryone: boolean;
};

export const BOARD_PIPELINE_SELECT = { id: true, key: true, name: true, kind: true } satisfies Prisma.SalesPipelineSelect;

export const BOARD_STAGE_SELECT = {
  id: true,
  key: true,
  name: true,
  position: true,
  probability: true,
  isWon: true,
  isLost: true,
  requiresValue: true,
  isNoShow: true,
  rottingDays: true,
} satisfies Prisma.SalesStageSelect;

const CARD_SELECT = {
  id: true,
  title: true,
  valueCents: true,
  mrrCents: true,
  stageId: true,
  status: true,
  stageEnteredAt: true,
  ownerId: true,
  person: { select: { name: true } },
  organization: { select: { name: true } },
} satisfies Prisma.SalesDealSelect;

const LIST_SELECT = { ...CARD_SELECT, stage: { select: { name: true } } } satisfies Prisma.SalesDealSelect;

type CardRow = Prisma.SalesDealGetPayload<{ select: typeof CARD_SELECT }>;
type NextStep = NonNullable<BoardCard["next"]>;

/** Newest in stage first (Decision 31): a card just moved sits at the top of its column. */
const COLUMN_ORDER: Prisma.SalesDealOrderByWithRelationInput[] = [{ stageEnteredAt: "desc" }, { id: "desc" }];
const LIST_ORDER: Prisma.SalesDealOrderByWithRelationInput[] = [{ updatedAt: "desc" }, { id: "desc" }];

const STATUS_BY_FILTER = { open: "OPEN", won: "WON", lost: "LOST" } as const;
const OPEN_ACTIVITY = { doneAt: null, archivedAt: null } as const;

/** True for the pipeline kinds the board shows (Delivery pipelines are hidden). */
export function isBoardPipeline<P extends { kind: string }>(pipeline: P): pipeline is P & { kind: BoardPipeline["kind"] } {
  return (BOARD_PIPELINE_KINDS as readonly string[]).includes(pipeline.kind);
}

async function loadBoardPipelines(db: BoardDb): Promise<BoardPipeline[]> {
  const rows = await db.salesPipeline.findMany({
    where: { archivedAt: null, kind: { in: [...BOARD_PIPELINE_KINDS] } },
    orderBy: { position: "asc" },
    select: BOARD_PIPELINE_SELECT,
  });
  return rows.filter(isBoardPipeline);
}

/** The pipeline the URL names, or the first one when it names none, an archived one or an unknown key. */
function resolvePipeline(pipelines: BoardPipeline[], key: string | null): BoardPipeline | null {
  return pipelines.find((pipeline) => pipeline.key === key) ?? pipelines[0] ?? null;
}

/** A pipeline's open stages in board order. */
export async function loadBoardStages(pipelineId: string, db: Pick<BoardDb, "salesStage"> = prisma): Promise<BoardStage[]> {
  return db.salesStage.findMany({
    where: { pipelineId, archivedAt: null },
    orderBy: { position: "asc" },
    select: BOARD_STAGE_SELECT,
  });
}

/** Team members who can own deals (admins and anyone with Sales access), by name. */
export async function loadSalesMembers(db: Pick<BoardDb, "teamMember"> = prisma): Promise<SalesMemberOption[]> {
  return db.teamMember.findMany({ where: SALES_MEMBER_WHERE, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/**
 * The deals one pipeline shows for this person and these filters. "Overdue" and
 * "Today" read the team's calendar day (app time). "Today" means the card's
 * next-step pill says Today: something due today and nothing overdue.
 */
export function boardDealWhere(
  actor: SalesActor,
  query: BoardQuery,
  pipelineId: string,
  now: Date,
): Prisma.SalesDealWhereInput {
  const today = dateInputValue(now);
  const overdue = { ...OPEN_ACTIVITY, dueAt: { lt: startOfDay(today) } };
  const activities: Prisma.SalesActivityListRelationFilter | null =
    query.next === "none"
      ? { none: OPEN_ACTIVITY }
      : query.next === "overdue"
        ? { some: overdue }
        : query.next === "today"
          ? { some: { ...OPEN_ACTIVITY, dueAt: { gte: startOfDay(today), lte: endOfDay(today) } }, none: overdue }
          : null;
  const contains = { contains: query.q, mode: "insensitive" } as const;

  return {
    pipelineId,
    archivedAt: null,
    status: STATUS_BY_FILTER[query.status],
    ...dealOwnerWhere(actor, query.scope),
    ...(activities ? { activities } : {}),
    ...(query.q ? { OR: [{ title: contains }, { organization: { name: contains } }, { person: { name: contains } }] } : {}),
  };
}

/** Each deal's earliest open activity, from one query over every deal shown. */
async function loadNextSteps(db: BoardDb, dealIds: string[]): Promise<Map<string, NextStep>> {
  const next = new Map<string, NextStep>();
  if (dealIds.length === 0) return next;
  const activities = await db.salesActivity.findMany({
    where: { dealId: { in: dealIds }, ...OPEN_ACTIVITY },
    select: { dealId: true, type: true, subject: true, dueAt: true },
  });
  const earliest = new Map<string, (typeof activities)[number]>();
  for (const activity of activities) {
    if (!activity.dealId) continue;
    const current = earliest.get(activity.dealId);
    if (!current || activity.dueAt < current.dueAt) earliest.set(activity.dealId, activity);
  }
  for (const [dealId, activity] of earliest) {
    next.set(dealId, { type: activity.type, subject: activity.subject, dueAt: activity.dueAt.toISOString() });
  }
  return next;
}

function toCard(row: CardRow, nextSteps: Map<string, NextStep>): BoardCard {
  return {
    id: row.id,
    title: row.title,
    valueCents: row.valueCents,
    mrrCents: row.mrrCents,
    stageId: row.stageId,
    status: row.status,
    stageEnteredAt: row.stageEnteredAt.toISOString(),
    ownerId: row.ownerId,
    personName: row.person?.name ?? null,
    organizationName: row.organization?.name ?? null,
    next: nextSteps.get(row.id) ?? null,
  };
}

/** One list page (50 rows), most recently updated first, continuing after `cursor` when given. */
async function queryListPage(
  db: BoardDb,
  where: Prisma.SalesDealWhereInput,
  cursor: string | null,
): Promise<DealListPage> {
  const rows = await db.salesDeal.findMany({
    where,
    select: LIST_SELECT,
    orderBy: LIST_ORDER,
    take: LIST_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, LIST_PAGE_SIZE);
  const nextSteps = await loadNextSteps(
    db,
    page.map((row) => row.id),
  );
  return {
    rows: page.map((row) => ({ ...toCard(row, nextSteps), stageName: row.stage.name })),
    nextCursor: rows.length > LIST_PAGE_SIZE ? page[page.length - 1].id : null,
  };
}

/** Each stage's newest 50 cards, with the true count and total of every matching deal in it. */
async function loadColumns(
  db: BoardDb,
  where: Prisma.SalesDealWhereInput,
  stages: BoardStage[],
  groups: { stageId: string; count: number; totalCents: number }[],
): Promise<BoardColumn[]> {
  const cardRows = await Promise.all(
    stages.map((stage) =>
      db.salesDeal.findMany({
        where: { ...where, stageId: stage.id },
        select: CARD_SELECT,
        orderBy: COLUMN_ORDER,
        take: BOARD_COLUMN_LIMIT,
      }),
    ),
  );
  const nextSteps = await loadNextSteps(
    db,
    cardRows.flat().map((row) => row.id),
  );
  const byStage = new Map(groups.map((group) => [group.stageId, group]));
  return stages.map((stage, index) => ({
    stage,
    count: byStage.get(stage.id)?.count ?? 0,
    totalCents: byStage.get(stage.id)?.totalCents ?? 0,
    cards: cardRows[index].map((row) => toCard(row, nextSteps)),
  }));
}

/**
 * Everything the Deals page needs for one pipeline. Null when no pipeline
 * exists yet. An unknown or archived pipeline key falls back to the first
 * pipeline. In list view `list` is always the first page; "Show more" pages
 * come from `loadDealListPage`.
 */
export async function loadBoardPage(
  actor: SalesActor,
  query: BoardQuery,
  now: Date,
  db: BoardDb = prisma,
): Promise<BoardPageData | null> {
  const pipelines = await loadBoardPipelines(db);
  const pipeline = resolvePipeline(pipelines, query.pipeline);
  if (!pipeline) return null;

  const where = boardDealWhere(actor, query, pipeline.id, now);
  const common = { query, pipelines, pipeline, canSeeEveryone: actor.isAdmin || actor.seesAllDeals };

  if (query.view === "list") {
    const [stages, members, list, totals] = await Promise.all([
      loadBoardStages(pipeline.id, db),
      loadSalesMembers(db),
      queryListPage(db, where, null),
      db.salesDeal.aggregate({ where, _count: { _all: true }, _sum: { valueCents: true } }),
    ]);
    return {
      ...common,
      stages,
      columns: null,
      list,
      totals: { count: totals._count._all, valueCents: totals._sum.valueCents ?? 0 },
      members,
    };
  }

  const [stages, members, groupRows] = await Promise.all([
    loadBoardStages(pipeline.id, db),
    loadSalesMembers(db),
    db.salesDeal.groupBy({ by: ["stageId"], where, _count: { _all: true }, _sum: { valueCents: true } }),
  ]);
  const groups = groupRows.map((group) => ({
    stageId: group.stageId,
    count: group._count._all,
    totalCents: group._sum.valueCents ?? 0,
  }));
  const columns = await loadColumns(db, where, stages, groups);
  return {
    ...common,
    stages,
    columns,
    list: null,
    totals: {
      count: groups.reduce((sum, group) => sum + group.count, 0),
      valueCents: groups.reduce((sum, group) => sum + group.totalCents, 0),
    },
    members,
  };
}

/**
 * One page of the list view for the "Show more" button: the same pipeline
 * fallback and filters as `loadBoardPage`, continuing after `query.cursor`.
 * Null when no pipeline exists yet.
 */
export async function loadDealListPage(
  actor: SalesActor,
  query: BoardQuery,
  now: Date,
  db: BoardDb = prisma,
): Promise<DealListPage | null> {
  const pipeline = resolvePipeline(await loadBoardPipelines(db), query.pipeline);
  if (!pipeline) return null;
  return queryListPage(db, boardDealWhere(actor, query, pipeline.id, now), query.cursor);
}
