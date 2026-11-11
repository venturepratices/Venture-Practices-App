import type { Prisma } from "@/generated/prisma/client";
import type { SalesActivityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import { loadSalesMembers, type SalesMemberOption } from "@/lib/sales/board";
import { LEADS_PAGE_SIZE, PRACTICE_ZIP_FIELD_KEY } from "@/lib/sales/constants";
import { loadAssignmentSummary, type AssignmentSummary } from "@/lib/sales/lead-assignment";
import type { LeadsQuery } from "@/lib/sales/leads-query";

// What the Leads Inbox lists: open leads, newest first, in pages of 50. Lead
// visibility is the deal rule (Decision 5): a rep set to see only their own
// deals sees only their own leads, whatever "Everyone / Just me" says. Only the
// columns a row shows are read (never a person's email or phone), each row's
// next step and Practice ZIP come from one query each over the rows shown, and
// the main query filters on the (ownerId, status, createdAt) index. Plain
// serializable rows, dates as ISO strings.

type LeadsDb = Pick<
  typeof prisma,
  "salesLead" | "salesActivity" | "salesCustomFieldValue" | "teamMember" | "salesSettings"
>;

export type LeadRow = {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  ownerId: string;
  personName: string | null;
  organizationName: string | null;
  /** The `practice-zip` lead field, or null when it is not set. */
  zip: string | null;
  /** The earliest open activity, or null when nothing is scheduled. `hasTime`: a clock time was chosen, so the pill shows it. */
  next: { type: SalesActivityType; subject: string; dueAt: string; hasTime: boolean } | null;
};

export type LeadRowsPage = { rows: LeadRow[]; nextCursor: string | null };

export type LeadsPageData = {
  /** As asked, without a cursor: the page always shows the first page. */
  query: LeadsQuery;
  rows: LeadRow[];
  nextCursor: string | null;
  members: SalesMemberOption[];
  /** False for someone set to see only their own deals: the Everyone / Just me switch is hidden. */
  canSeeEveryone: boolean;
  /** Who gets new leads, for the footer line. */
  assignment: AssignmentSummary;
};

const ROW_SELECT = {
  id: true,
  title: true,
  source: true,
  createdAt: true,
  ownerId: true,
  person: { select: { name: true } },
  organization: { select: { name: true } },
} satisfies Prisma.SalesLeadSelect;

const NEWEST_FIRST: Prisma.SalesLeadOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];
const SOONEST_DUE_FIRST: Prisma.SalesActivityOrderByWithRelationInput[] = [{ dueAt: "asc" }, { id: "asc" }];

type NextStep = NonNullable<LeadRow["next"]>;

/**
 * The leads this person's Inbox shows: open, not deleted, theirs unless they
 * see everyone's (and theirs under "Just me" whoever they are), matching the
 * search on the title, the organization or the person.
 */
export function leadsInboxWhere(actor: SalesActor, query: LeadsQuery): Prisma.SalesLeadWhereInput {
  const contains = { contains: query.q, mode: "insensitive" } as const;
  return {
    status: "OPEN",
    archivedAt: null,
    ...dealOwnerWhere(actor, query.scope),
    ...(query.q ? { OR: [{ title: contains }, { organization: { name: contains } }, { person: { name: contains } }] } : {}),
  };
}

/**
 * Each lead's earliest open activity, from one query over every lead shown.
 * Only activities still on the lead count (`dealId: null`): once a convert moves
 * one to its deal, the lead no longer owns it.
 */
async function loadNextSteps(db: LeadsDb, leadIds: string[]): Promise<Map<string, NextStep>> {
  const activities = await db.salesActivity.findMany({
    where: { leadId: { in: leadIds }, dealId: null, doneAt: null, archivedAt: null },
    orderBy: SOONEST_DUE_FIRST,
    select: { leadId: true, type: true, subject: true, dueAt: true, hasTime: true },
  });
  const next = new Map<string, NextStep>();
  for (const activity of activities) {
    // Soonest due first, so the first one seen for a lead is its next step.
    if (!activity.leadId || next.has(activity.leadId)) continue;
    next.set(activity.leadId, {
      type: activity.type,
      subject: activity.subject,
      dueAt: activity.dueAt.toISOString(),
      hasTime: activity.hasTime,
    });
  }
  return next;
}

/** Each lead's Practice ZIP, from one query over every lead shown. */
async function loadZips(db: LeadsDb, leadIds: string[]): Promise<Map<string, string>> {
  const values = await db.salesCustomFieldValue.findMany({
    where: { leadId: { in: leadIds }, field: { key: PRACTICE_ZIP_FIELD_KEY } },
    select: { leadId: true, value: true },
  });
  return new Map(values.flatMap((row) => (row.leadId ? [[row.leadId, row.value] as const] : [])));
}

/** One page (50 rows) of the Inbox, newest first, continuing after `query.cursor` when there is one. */
export async function loadLeadRows(actor: SalesActor, query: LeadsQuery, db: LeadsDb = prisma): Promise<LeadRowsPage> {
  const rows = await db.salesLead.findMany({
    where: leadsInboxWhere(actor, query),
    select: ROW_SELECT,
    orderBy: NEWEST_FIRST,
    take: LEADS_PAGE_SIZE + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, LEADS_PAGE_SIZE);
  if (page.length === 0) return { rows: [], nextCursor: null };

  const ids = page.map((row) => row.id);
  const [nextSteps, zips] = await Promise.all([loadNextSteps(db, ids), loadZips(db, ids)]);
  return {
    rows: page.map((row) => ({
      id: row.id,
      title: row.title,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      ownerId: row.ownerId,
      personName: row.person?.name ?? null,
      organizationName: row.organization?.name ?? null,
      zip: zips.get(row.id) ?? null,
      next: nextSteps.get(row.id) ?? null,
    })),
    nextCursor: rows.length > LEADS_PAGE_SIZE ? page[page.length - 1].id : null,
  };
}

/**
 * Everything the Leads Inbox needs: always the first page (a cursor in the URL
 * is ignored), the people who can own leads, whether to show the Everyone /
 * Just me switch, and who gets new leads. "Show more" pages come from
 * `loadLeadRows`.
 */
export async function loadLeadsPage(actor: SalesActor, query: LeadsQuery, db: LeadsDb = prisma): Promise<LeadsPageData> {
  const firstPage = { ...query, cursor: null };
  const [page, members, assignment] = await Promise.all([
    loadLeadRows(actor, firstPage, db),
    loadSalesMembers(db),
    loadAssignmentSummary(db),
  ]);
  return {
    query: firstPage,
    rows: page.rows,
    nextCursor: page.nextCursor,
    members,
    canSeeEveryone: actor.isAdmin || actor.seesAllDeals,
    assignment,
  };
}
