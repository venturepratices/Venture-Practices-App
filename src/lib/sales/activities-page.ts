import type { Prisma } from "@/generated/prisma/client";
import type { SalesActivityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import type { ActivitiesQuery } from "@/lib/sales/activities-query";
import { loadSalesMembers, type SalesMemberOption } from "@/lib/sales/board";
import { ACTIVITIES_PAGE_SIZE } from "@/lib/sales/constants";
import { dateInputValue, endOfDay, startOfDay } from "@/lib/utils";

// What the Activities page lists: activities on deals, in pages of 50. The
// deal-visibility rule is always part of the filter, whatever "Everyone / Just
// me" says, so an activity never shows on a deal its viewer may not open (a
// deal moved to another rep takes its activities out of the old rep's list).
// Only the columns a row shows are read, and the filters use the activity
// indexes (owner, done, due). Plain serializable rows, dates as ISO strings.

type ActivitiesDb = Pick<typeof prisma, "salesActivity" | "teamMember">;

export type ActivityRow = {
  id: string;
  type: SalesActivityType;
  subject: string;
  dueAt: string;
  hasTime: boolean;
  doneAt: string | null;
  ownerId: string;
  deal: { id: string; title: string; ownerId: string };
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
} satisfies Prisma.SalesActivitySelect;

/** Soonest due first while there is work to do; most recently done first once it is done. */
const TO_DO_ORDER: Prisma.SalesActivityOrderByWithRelationInput[] = [{ dueAt: "asc" }, { id: "asc" }];
const DONE_ORDER: Prisma.SalesActivityOrderByWithRelationInput[] = [{ doneAt: "desc" }, { id: "desc" }];

/**
 * The activities this person's list shows. "Overdue" and "Today" read the
 * team's calendar day (app time), so something due at 9 AM is still "Today" at
 * 11:30 PM Eastern. Lists of work to do show only open deals; "Done" shows done
 * activities on any deal still there. "Just me" means activities the person
 * owns, on top of (never instead of) the deals they may see.
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
    dealId: { not: null },
    ...(dueAt ? { dueAt } : {}),
    ...(query.type !== "all" ? { type: query.type } : {}),
    ...(query.scope === "mine" ? { ownerId: actor.userId } : {}),
    deal: {
      ...(done ? {} : { status: "OPEN" as const }),
      archivedAt: null,
      ...dealOwnerWhere(actor, "everyone"),
    },
  };
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
    // The filter only lets through activities on a deal; the check keeps the type honest.
    rows: page.flatMap((row) =>
      row.deal
        ? [
            {
              id: row.id,
              type: row.type,
              subject: row.subject,
              dueAt: row.dueAt.toISOString(),
              hasTime: row.hasTime,
              doneAt: row.doneAt?.toISOString() ?? null,
              ownerId: row.ownerId,
              deal: row.deal,
            },
          ]
        : [],
    ),
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
