import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canDeleteSalesRecords, dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import type { SalesMemberOption } from "@/lib/sales/board";
import { CONTACT_LINKED_ROWS } from "@/lib/sales/constants";
import { canEditContact, visibleOrganizationWhere, visiblePersonWhere } from "@/lib/sales/contact-access";
import type { ContactKind } from "@/lib/sales/contacts-query";
import { findOrganizationDuplicates, findPersonDuplicates, type DuplicateInfo } from "@/lib/sales/duplicates";

// What the slide-in contact panel shows (Decision 19): a person or an
// organization this viewer may see (Decision 18), the deals and leads on it
// that the viewer may see (the Deals board's owner rule), an organization's
// people the viewer may see, possible duplicates, and who may edit and merge.
// Each list shows 20 rows; its count runs the list's own `where`, so "Showing
// 20 of {n}." never counts what the viewer may not see (A4). After the visible
// lookup every read runs side by side in one Promise.all. History pages
// separately (timeline.ts). Plain serializable values, dates as ISO strings.

type ContactPanelDb = Pick<typeof prisma, "salesPerson" | "salesOrganization" | "salesDeal" | "salesLead">;

export type ContactLinkedDeal = {
  id: string;
  title: string;
  status: "OPEN" | "WON" | "LOST";
  stageName: string;
  valueCents: number;
};

export type ContactLinkedLead = { id: string; title: string; status: "OPEN" | "CONVERTED" | "ARCHIVED" };

type PanelCommon = {
  deals: ContactLinkedDeal[];
  leads: ContactLinkedLead[];
  duplicates: DuplicateInfo;
  /** The contact's owner or an admin. */
  canEdit: boolean;
  /** Signed-in admins only. */
  canMerge: boolean;
  /** The id of the merged contact an old link named, when the panel opened the contact it was merged into. */
  redirectedFrom: string | null;
};

export type PersonPanelData = PanelCommon & {
  kind: "person";
  person: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
    /** `visible`: whether this viewer may open the organization. When false the panel shows its name as plain text. */
    organization: { id: string; name: string; visible: boolean } | null;
    owner: SalesMemberOption;
    createdAt: string;
  };
  counts: { deals: number; leads: number };
};

export type OrganizationPanelData = PanelCommon & {
  kind: "organization";
  organization: {
    id: string;
    name: string;
    phone: string | null;
    website: string | null;
    address: string | null;
    zip: string | null;
    owner: SalesMemberOption;
    createdAt: string;
  };
  people: { id: string; name: string }[];
  counts: { people: number; deals: number; leads: number };
};

export type ContactPanelData = PersonPanelData | OrganizationPanelData;

const PERSON_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  ownerId: true,
  createdAt: true,
  emailKey: true,
  phoneKey: true,
  nameKey: true,
  organizationId: true,
  organization: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.SalesPersonSelect;

const ORGANIZATION_SELECT = {
  id: true,
  name: true,
  phone: true,
  website: true,
  address: true,
  zip: true,
  nameKey: true,
  ownerId: true,
  createdAt: true,
  owner: { select: { id: true, name: true } },
} satisfies Prisma.SalesOrganizationSelect;

const DEAL_SELECT = {
  id: true,
  title: true,
  status: true,
  valueCents: true,
  stage: { select: { name: true } },
} satisfies Prisma.SalesDealSelect;

const LEAD_SELECT = { id: true, title: true, status: true } satisfies Prisma.SalesLeadSelect;

// Open first: the status enums list OPEN first.
const DEALS_OPEN_FIRST: Prisma.SalesDealOrderByWithRelationInput[] = [{ status: "asc" }, { updatedAt: "desc" }];
const LEADS_OPEN_FIRST: Prisma.SalesLeadOrderByWithRelationInput[] = [{ status: "asc" }, { createdAt: "desc" }];
const BY_NAME: Prisma.SalesPersonOrderByWithRelationInput[] = [{ name: "asc" }, { id: "asc" }];

type ContactLink = { personId: string } | { organizationId: string };

/** The deals and leads on a contact that this viewer may see, 20 of each, with their true counts. */
function linkedRecords(db: ContactPanelDb, actor: SalesActor, link: ContactLink) {
  const owner = dealOwnerWhere(actor, "everyone");
  const dealWhere: Prisma.SalesDealWhereInput = { ...link, archivedAt: null, ...owner };
  const leadWhere: Prisma.SalesLeadWhereInput = { ...link, archivedAt: null, ...owner };
  return [
    db.salesDeal.findMany({ where: dealWhere, orderBy: DEALS_OPEN_FIRST, take: CONTACT_LINKED_ROWS, select: DEAL_SELECT }),
    db.salesLead.findMany({ where: leadWhere, orderBy: LEADS_OPEN_FIRST, take: CONTACT_LINKED_ROWS, select: LEAD_SELECT }),
    db.salesDeal.count({ where: dealWhere }),
    db.salesLead.count({ where: leadWhere }),
  ] as const;
}

function toLinkedDeal(deal: Prisma.SalesDealGetPayload<{ select: typeof DEAL_SELECT }>): ContactLinkedDeal {
  return { id: deal.id, title: deal.title, status: deal.status, stageName: deal.stage.name, valueCents: deal.valueCents };
}

function rights(actor: SalesActor, contact: { ownerId: string }) {
  return { canEdit: canEditContact(actor, contact), canMerge: canDeleteSalesRecords(actor) };
}

async function loadPersonPanel(
  actor: SalesActor,
  id: string,
  redirectedFrom: string | null,
  db: ContactPanelDb,
): Promise<PersonPanelData | null> {
  const person = await db.salesPerson.findFirst({ where: { id, ...visiblePersonWhere(actor, "everyone") }, select: PERSON_SELECT });
  if (!person) return null;

  const [[deals, leads, dealCount, leadCount], organizationVisible, duplicates] = await Promise.all([
    Promise.all(linkedRecords(db, actor, { personId: person.id })),
    person.organizationId
      ? db.salesOrganization
          .findFirst({ where: { id: person.organizationId, ...visibleOrganizationWhere(actor, "everyone") }, select: { id: true } })
          .then((row) => row !== null)
      : Promise.resolve(false),
    findPersonDuplicates(db, actor, person),
  ]);

  return {
    kind: "person",
    person: {
      id: person.id,
      name: person.name,
      email: person.email,
      phone: person.phone,
      role: person.role,
      organization: person.organization ? { ...person.organization, visible: organizationVisible } : null,
      owner: person.owner,
      createdAt: person.createdAt.toISOString(),
    },
    deals: deals.map(toLinkedDeal),
    leads,
    counts: { deals: dealCount, leads: leadCount },
    duplicates,
    ...rights(actor, person),
    redirectedFrom,
  };
}

async function loadOrganizationPanel(
  actor: SalesActor,
  id: string,
  redirectedFrom: string | null,
  db: ContactPanelDb,
): Promise<OrganizationPanelData | null> {
  const organization = await db.salesOrganization.findFirst({
    where: { id, ...visibleOrganizationWhere(actor, "everyone") },
    select: ORGANIZATION_SELECT,
  });
  if (!organization) return null;

  const peopleWhere: Prisma.SalesPersonWhereInput = { organizationId: organization.id, ...visiblePersonWhere(actor, "everyone") };
  const [people, peopleCount, [deals, leads, dealCount, leadCount], duplicates] = await Promise.all([
    db.salesPerson.findMany({ where: peopleWhere, orderBy: BY_NAME, take: CONTACT_LINKED_ROWS, select: { id: true, name: true } }),
    db.salesPerson.count({ where: peopleWhere }),
    Promise.all(linkedRecords(db, actor, { organizationId: organization.id })),
    findOrganizationDuplicates(db, actor, organization),
  ]);

  return {
    kind: "organization",
    organization: {
      id: organization.id,
      name: organization.name,
      phone: organization.phone,
      website: organization.website,
      address: organization.address,
      zip: organization.zip,
      owner: organization.owner,
      createdAt: organization.createdAt.toISOString(),
    },
    people,
    deals: deals.map(toLinkedDeal),
    leads,
    counts: { people: peopleCount, deals: dealCount, leads: leadCount },
    duplicates,
    ...rights(actor, organization),
    redirectedFrom,
  };
}

/** The id a merged contact was merged into, or null when `id` was never merged (or does not exist). */
async function mergedIntoId(db: ContactPanelDb, kind: ContactKind, id: string): Promise<string | null> {
  const args = { where: { id, mergedIntoId: { not: null } }, select: { mergedIntoId: true } } as const;
  const row = kind === "person" ? await db.salesPerson.findFirst(args) : await db.salesOrganization.findFirst(args);
  return row?.mergedIntoId ?? null;
}

/**
 * The panel for one person or organization, or null when this person may not
 * see it, or it is archived or missing. The caller answers null with "Contact
 * not found." (404). An old link to a merged contact opens the contact it was
 * merged into, when this person may see that one (one hop only; a chain of
 * merges is not followed), with `redirectedFrom` naming the old id.
 */
export async function loadContactPanel(
  actor: SalesActor,
  kind: ContactKind,
  id: string,
  db: ContactPanelDb = prisma,
): Promise<ContactPanelData | null> {
  const load = kind === "person" ? loadPersonPanel : loadOrganizationPanel;
  const panel = await load(actor, id, null, db);
  if (panel) return panel;

  const keptId = await mergedIntoId(db, kind, id);
  return keptId ? load(actor, keptId, id, db) : null;
}
