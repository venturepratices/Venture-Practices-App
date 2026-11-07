import type { Prisma } from "@/generated/prisma/client";
import type { SalesActivityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import type { ActivitiesQuery } from "@/lib/sales/activities-query";
import { loadSalesMembers, type SalesMemberOption } from "@/lib/sales/board";
import { ACTIVITIES_PAGE_SIZE } from "@/lib/sales/constants";
import { dateInputValue, endOfDay, startOfDay } from "@/lib/utils";

// What the Activities page lists: activities on deals and leads, in pages of
// 50. The deal and lead visibility rules are always part of the filter, whatever
// "Everyone / Just me" says, so an activity never shows on a deal or lead its
// viewer may not open (one moved to another rep takes its activities out of the
// old rep's list). An activity answers to its lead only while it has no deal:
// a convert moves the lead's open activities to the new deal and keeps their
// lead, and from then on only the deal decides. Only the columns a row shows
// are read, and the filters use the activity indexes (owner, done, due). Plain
// serializable rows, dates as ISO strings.

type ActivitiesDb = Pick<typeof prisma, "salesActivity" | "teamMember">;

/** The deal or lead an activity is on, as a row shows and opens it. */
export type ActivityParent = { kind: "deal" | "lead"; id: string; title: string; ownerId: string };

export type ActivityRow = {
  id: string;
  type: SalesActivityType;
  subject: string;
  dueAt: string;
  hasTime: boolean;
  doneAt: string | null;
  ownerId: string;
  parent: ActivityParent;
};

export type ActivityRowsPage = { rows: ActivityRow[]; nextCursor: string | null };

export type ActivitiesPageData = {
  /** As asked, without a cursor: the page always shows the first page. */
  query: ActivitiesQuery;
  rows: ActivityRow[];
  nextCursor: string | null;
  members: SalesMemberOption[];
  /** False for someone set to see only their own deals: the Everyone / Just me switch is hidden. */
  canSeeEveryone: boolean;
};

const ROW_SELECT = {
  id: true,
  type: true,
  subject: true,
  dueAt: true,
  hasTime: true,
  doneAt: true,
  ownerId: true,
  deal: { select: { id: true, title: true, ownerId: true } },
  lead: { select: { id: true, title: true, ownerId: true } },
} satisfies Prisma.SalesActivitySelect;

/** Soonest due first while there is work to do; most recently done first once it is done. */
const TO_DO_ORDER: Prisma.SalesActivityOrderByWithRelationInput[] = [{ dueAt: "asc" }, { id: "asc" }];
const DONE_ORDER: Prisma.SalesActivityOrderByWithRelationInput[] = [{ doneAt: "desc" }, { id: "desc" }];

/**
 * Which deal or lead an activity may be listed through for this person: a deal
 * activity through its deal, or an activity with no deal through its lead,
 * either one still there (not deleted) and one the person may see. Lists of
 * work to do (`done` false) ask for open deals and leads only; done lists take
 * any status. Shared by the Activities page and the dashboard.
 */
export function activityParentWhere(actor: SalesActor, done: boolean): Prisma.SalesActivityWhereInput {
  const status = done ? {} : { status: "OPEN" as const };
  const owner = dealOwnerWhere(actor, "everyone");
  return {
    OR: [
      { dealId: { not: null }, deal: { archivedAt: null, ...status, ...owner } },
      { dealId: null, leadId: { not: null }, lead: { archivedAt: null, ...status, ...owner } },
    ],
  };
}

/**
 * The activities this person's list shows. "Overdue" and "Today" read the
 * team's calendar day (app time), so something due at 9 AM is still "Today" at
 * 11:30 PM Eastern. Lists of work to do show only open deals and leads; "Done"
 * shows done activities on any deal or lead still there. "Just me" means
 * activities the person owns, on top of (never instead of) the deals and leads
 * they may see.
 */
export function activitiesWhere(actor: SalesActor, query: ActivitiesQuery, now: Date): Prisma.SalesActivityWhereInput {
  const today = dateInputValue(now);
  const done = query.when === "done";
  const dueAt =
    query.when === "overdue"
      ? { lt: startOfDay(today) }
      : query.when === "today"
        ? { gte: startOfDay(today), lte: endOfDay(today) }
        : null;

  return {
    doneAt: done ? { not: null } : null,
    archivedAt: null,
    ...(dueAt ? { dueAt } : {}),
    ...(query.type !== "all" ? { type: query.type } : {}),
    ...(query.scope === "mine" ? { ownerId: actor.userId } : {}),
    ...activityParentWhere(actor, done),
  };
}

/** The row's deal, or its lead when it has no deal (the filter lets nothing else through). */
function rowParent(row: {
  deal: { id: string; title: string; ownerId: string } | null;
  lead: { id: string; title: string; ownerId: string } | null;
}): ActivityParent | null {
  if (row.deal) return { kind: "deal", ...row.deal };
  if (row.lead) return { kind: "lead", ...row.lead };
  return null;
}

/** One page (50 rows) of the list, continuing after `query.cursor` when there is one. */
export async function loadActivityRows(
  actor: SalesActor,
  query: ActivitiesQuery,
  now: Date,
  db: ActivitiesDb = prisma,
): Promise<ActivityRowsPage> {
  const rows = await db.salesActivity.findMany({
    where: activitiesWhere(actor, query, now),
    orderBy: query.when === "done" ? DONE_ORDER : TO_DO_ORDER,
    take: ACTIVITIES_PAGE_SIZE + 1,
    select: ROW_SELECT,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, ACTIVITIES_PAGE_SIZE);
  return {
    // The filter only lets through activities on a deal or a lead; the check keeps the type honest.
    rows: page.flatMap((row) => {
      const parent = rowParent(row);
      return parent
        ? [
            {
              id: row.id,
              type: row.type,
              subject: row.subject,
              dueAt: row.dueAt.toISOString(),
              hasTime: row.hasTime,
              doneAt: row.doneAt?.toISOString() ?? null,
              ownerId: row.ownerId,
              parent,
            },
          ]
        : [];
    }),
    nextCursor: rows.length > ACTIVITIES_PAGE_SIZE ? page[page.length - 1].id : null,
  };
}

/**
 * Everything the Activities page needs: always the first page (a cursor in the
 * URL is ignored), the people who can own deals, and whether to show the
 * Everyone / Just me switch. "Show more" pages come from `loadActivityRows`.
 */
export async function loadActivitiesPage(
  actor: SalesActor,
  query: ActivitiesQuery,
  now: Date,
  db: ActivitiesDb = prisma,
): Promise<ActivitiesPageData> {
  const firstPage = { ...query, cursor: null };
  const [page, members] = await Promise.all([loadActivityRows(actor, firstPage, now, db), loadSalesMembers(db)]);
  return {
    query: firstPage,
    rows: page.rows,
    nextCursor: page.nextCursor,
    members,
    canSeeEveryone: actor.isAdmin || actor.seesAllDeals,
  };
}
