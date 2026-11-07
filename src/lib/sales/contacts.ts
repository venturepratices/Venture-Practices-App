import { prisma } from "@/lib/prisma";
import type { SalesActor } from "@/lib/sales/access";
import { CONTACT_SEARCH_LIMIT } from "@/lib/sales/constants";
import { visibleOrganizationWhere, visiblePersonWhere } from "@/lib/sales/contact-access";

// The organization and person pickers in the Add deal dialog. Contacts'
// who-can-see rule (Decision 18): someone set to see only their own deals finds
// the organizations and people they own or that sit on a live deal or lead they
// own. Names only, never a person's email or phone.

type ContactsDb = Pick<typeof prisma, "salesOrganization" | "salesPerson">;

export type ContactResult = { id: string; name: string; organizationName?: string | null };

/** A search shorter than this finds nothing (spec 7.4: search from two letters). */
const SEARCH_MIN = 2;
const SEARCH_MAX = 100;

/** Up to 8 organizations or people whose name contains `q`, by name. */
export async function searchContacts(
  actor: SalesActor,
  kind: "organization" | "person",
  q: string,
  db: ContactsDb = prisma,
): Promise<ContactResult[]> {
  const search = q.trim().slice(0, SEARCH_MAX);
  if (search.length < SEARCH_MIN) return [];

  const name = { contains: search, mode: "insensitive" as const };
  const page = { orderBy: { name: "asc" as const }, take: CONTACT_SEARCH_LIMIT };

  if (kind === "organization") {
    return db.salesOrganization.findMany({
      where: { ...visibleOrganizationWhere(actor, "everyone"), name },
      select: { id: true, name: true },
      ...page,
    });
  }
  const people = await db.salesPerson.findMany({
    where: { ...visiblePersonWhere(actor, "everyone"), name },
    select: { id: true, name: true, organization: { select: { name: true } } },
    ...page,
  });
  return people.map((person) => ({ id: person.id, name: person.name, organizationName: person.organization?.name ?? null }));
}
