import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import { loadSalesMembers, type SalesMemberOption } from "@/lib/sales/board";
import { CONTACTS_PAGE_SIZE } from "@/lib/sales/constants";
import { visibleOrganizationWhere, visiblePersonWhere } from "@/lib/sales/contact-access";
import type { ContactsQuery } from "@/lib/sales/contacts-query";

// What the Contacts page lists: people or organizations, by name, in pages of
// 50. Who may see a contact is Decision 18 (contact-access.ts); a search never
// widens it. Only the columns a row shows are read (never a person's email or
// phone, spec 3.10), and each row's open-deal count carries the Deals board's
// owner filter, so a see-own rep never learns how many deals another rep has
// with a contact (A4). Plain serializable rows.

type ContactsDb = Pick<typeof prisma, "salesPerson" | "salesOrganization" | "teamMember">;

export type PersonRow = {
  kind: "person";
  id: string;
  name: string;
  organizationName: string | null;
  openDeals: number;
  ownerId: string;
};

export type OrganizationRow = {
  kind: "organization";
  id: string;
  name: string;
  /** The organization's first person this viewer may see, or null. */
  contactName: string | null;
  openDeals: number;
  ownerId: string;
};

export type ContactRow = PersonRow | OrganizationRow;

export type ContactRowsPage = { rows: ContactRow[]; nextCursor: string | null };

export type ContactsPageData = {
  /** As asked, without a cursor: the page always shows the first page. */
  query: ContactsQuery;
  rows: ContactRow[];
  nextCursor: string | null;
  members: SalesMemberOption[];
  /** False for someone set to see only their own deals: the Everyone / Just me switch is hidden. */
  canSeeEveryone: boolean;
};

const BY_NAME = [{ name: "asc" }, { id: "asc" }] satisfies Prisma.SalesPersonOrderByWithRelationInput[];
const OLDEST_FIRST = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.SalesPersonOrderByWithRelationInput[];

/** A contact's open deals that this person may see (the Deals board's owner rule). */
function openDealsCount(actor: SalesActor) {
  return { deals: { where: { status: "OPEN", archivedAt: null, ...dealOwnerWhere(actor, "everyone") } } } as const;
}

/** `visible`, narrowed by `search` when there is one. AND keeps the search from loosening the visibility OR. */
function withSearch<W>(visible: W, search: W | null): W | { AND: W[] } {
  return search ? { AND: [visible, search] } : visible;
}

function page<T extends { id: string }>(rows: T[]): { shown: T[]; nextCursor: string | null } {
  const shown = rows.slice(0, CONTACTS_PAGE_SIZE);
  return { shown, nextCursor: rows.length > CONTACTS_PAGE_SIZE ? shown[shown.length - 1].id : null };
}

/** Continue after the cursor row (skipping it) when "Show more" sent one. */
function cursorArgs(query: ContactsQuery): { cursor?: { id: string }; skip?: number } {
  return query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {};
}

async function loadPeopleRows(actor: SalesActor, query: ContactsQuery, db: ContactsDb): Promise<ContactRowsPage> {
  const contains = { contains: query.q, mode: "insensitive" } as const;
  const rows = await db.salesPerson.findMany({
    where: withSearch<Prisma.SalesPersonWhereInput>(
      visiblePersonWhere(actor, query.scope),
      query.q ? { OR: [{ name: contains }, { organization: { name: contains } }] } : null,
    ),
    select: {
      id: true,
      name: true,
      ownerId: true,
      organization: { select: { name: true } },
      _count: { select: openDealsCount(actor) },
    },
    orderBy: BY_NAME,
    take: CONTACTS_PAGE_SIZE + 1,
    ...cursorArgs(query),
  });
  const { shown, nextCursor } = page(rows);
  return {
    rows: shown.map((row) => ({
      kind: "person",
      id: row.id,
      name: row.name,
      organizationName: row.organization?.name ?? null,
      openDeals: row._count.deals,
      ownerId: row.ownerId,
    })),
    nextCursor,
  };
}

async function loadOrganizationRows(actor: SalesActor, query: ContactsQuery, db: ContactsDb): Promise<ContactRowsPage> {
  const rows = await db.salesOrganization.findMany({
    where: withSearch<Prisma.SalesOrganizationWhereInput>(
      visibleOrganizationWhere(actor, query.scope),
      query.q ? { name: { contains: query.q, mode: "insensitive" } } : null,
    ),
    select: {
      id: true,
      name: true,
      ownerId: true,
      // The Contact column names only someone this viewer may see.
      people: { where: visiblePersonWhere(actor, "everyone"), orderBy: OLDEST_FIRST, take: 1, select: { name: true } },
      _count: { select: openDealsCount(actor) },
    },
    orderBy: BY_NAME,
    take: CONTACTS_PAGE_SIZE + 1,
    ...cursorArgs(query),
  });
  const { shown, nextCursor } = page(rows);
  return {
    rows: shown.map((row) => ({
      kind: "organization",
      id: row.id,
      name: row.name,
      contactName: row.people[0]?.name ?? null,
      openDeals: row._count.deals,
      ownerId: row.ownerId,
    })),
    nextCursor,
  };
}

/** One page (50 rows) of the tab asked for, by name, continuing after `query.cursor` when there is one. */
export async function loadContactRows(
  actor: SalesActor,
  query: ContactsQuery,
  db: ContactsDb = prisma,
): Promise<ContactRowsPage> {
  return query.tab === "organizations" ? loadOrganizationRows(actor, query, db) : loadPeopleRows(actor, query, db);
}

/**
 * Everything the Contacts page needs: always the first page (a cursor in the
 * URL is ignored), the people who can own contacts, and whether to show the
 * Everyone / Just me switch. "Show more" pages come from `loadContactRows`.
 */
export async function loadContactsPage(
  actor: SalesActor,
  query: ContactsQuery,
  db: ContactsDb = prisma,
): Promise<ContactsPageData> {
  const firstPage = { ...query, cursor: null };
  const [contacts, members] = await Promise.all([loadContactRows(actor, firstPage, db), loadSalesMembers(db)]);
  return {
    query: firstPage,
    rows: contacts.rows,
    nextCursor: contacts.nextCursor,
    members,
    canSeeEveryone: actor.isAdmin || actor.seesAllDeals,
  };
}
