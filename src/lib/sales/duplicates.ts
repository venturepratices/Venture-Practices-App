import type { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/lib/prisma";
import type { SalesActor } from "@/lib/sales/access";
import { DUPLICATE_MATCHES_MAX } from "@/lib/sales/constants";
import { visibleOrganizationWhere, visiblePersonWhere } from "@/lib/sales/contact-access";

// Possible duplicates of a contact, for the contact panel's warn bar (Decision
// 17, spec 9.1 matching). Matches come from the stored keys (contact-keys.ts):
// a person with the same email, the same phone, or the same name in the same
// practice; an organization with the same name, and the same ZIP when both
// have one. The bar names only matches this person may see (A4); a match they
// may not see is a plain flag, never a name, read with one exact `NOT visible`
// query that is skipped for anyone who sees every contact.

type DuplicatesDb = Pick<typeof prisma, "salesPerson" | "salesOrganization">;

export type DuplicateInfo = {
  /** Up to 5 matches this person may see, by name. */
  matches: { id: string; name: string }[];
  /** True when a match exists that this person may not see ("Ask an admin to merge."). */
  hiddenMatch: boolean;
};

const NO_DUPLICATES: DuplicateInfo = { matches: [], hiddenMatch: false };

/** Only someone limited to their own contacts can have a match they may not see. */
function seesEveryContact(actor: SalesActor): boolean {
  return actor.isAdmin || actor.seesAllDeals;
}

export async function findPersonDuplicates(
  db: DuplicatesDb,
  actor: SalesActor,
  person: { id: string; emailKey: string | null; phoneKey: string | null; nameKey: string | null; organizationId: string | null },
): Promise<DuplicateInfo> {
  const keys: Prisma.SalesPersonWhereInput[] = [];
  if (person.emailKey) keys.push({ emailKey: person.emailKey });
  if (person.phoneKey) keys.push({ phoneKey: person.phoneKey });
  // A name matches only within the same practice: two "Sarah K."s at different practices are two people.
  if (person.nameKey && person.organizationId) keys.push({ nameKey: person.nameKey, organizationId: person.organizationId });
  if (keys.length === 0) return NO_DUPLICATES;

  const match: Prisma.SalesPersonWhereInput = { id: { not: person.id }, archivedAt: null, OR: keys };
  const visible = visiblePersonWhere(actor, "everyone");
  const [matches, hidden] = await Promise.all([
    db.salesPerson.findMany({
      where: { AND: [match, visible] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: DUPLICATE_MATCHES_MAX,
    }),
    seesEveryContact(actor)
      ? Promise.resolve(null)
      : db.salesPerson.findFirst({ where: { AND: [match, { NOT: visible }] }, select: { id: true } }),
  ]);
  return { matches, hiddenMatch: hidden !== null };
}

export async function findOrganizationDuplicates(
  db: DuplicatesDb,
  actor: SalesActor,
  org: { id: string; nameKey: string | null; zip: string | null },
): Promise<DuplicateInfo> {
  if (!org.nameKey) return NO_DUPLICATES;

  // Two practices with the same name in different ZIPs are two practices; a missing ZIP on either side still matches.
  const match: Prisma.SalesOrganizationWhereInput = {
    id: { not: org.id },
    archivedAt: null,
    nameKey: org.nameKey,
    ...(org.zip ? { OR: [{ zip: null }, { zip: org.zip }] } : {}),
  };
  const visible = visibleOrganizationWhere(actor, "everyone");
  const [matches, hidden] = await Promise.all([
    db.salesOrganization.findMany({
      where: { AND: [match, visible] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: DUPLICATE_MATCHES_MAX,
    }),
    seesEveryContact(actor)
      ? Promise.resolve(null)
      : db.salesOrganization.findFirst({ where: { AND: [match, { NOT: visible }] }, select: { id: true } }),
  ]);
  return { matches, hiddenMatch: hidden !== null };
}
