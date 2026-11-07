import type { Prisma } from "@/generated/prisma/client";
import type { SalesActor } from "@/lib/sales/access";

// Who may see and change an organization or a person (Decision 18). An admin,
// or someone who sees every deal, sees every live contact. Anyone else sees the
// contacts they own and the ones on a live deal or lead they own. Lists,
// pickers, counts and duplicate checks all use these same filters.

export const CONTACT_NOT_FOUND = "Contact not found.";
export const NOT_YOUR_CONTACT = "Only the contact's owner or an admin can change this contact.";

type ContactWhere = Prisma.SalesPersonWhereInput & Prisma.SalesOrganizationWhereInput;

/** "mine" = contacts the actor owns; "everyone" = every contact the actor may see. */
function visibleContactWhere(actor: SalesActor, scope: "everyone" | "mine"): ContactWhere {
  const userId = actor.userId;
  if (scope === "mine") return { archivedAt: null, ownerId: userId };
  if (actor.isAdmin || actor.seesAllDeals) return { archivedAt: null };
  return {
    archivedAt: null,
    OR: [
      { ownerId: userId },
      { deals: { some: { ownerId: userId, archivedAt: null } } },
      { leads: { some: { ownerId: userId, archivedAt: null } } },
    ],
  };
}

export function visiblePersonWhere(actor: SalesActor, scope: "everyone" | "mine"): Prisma.SalesPersonWhereInput {
  return visibleContactWhere(actor, scope);
}

export function visibleOrganizationWhere(actor: SalesActor, scope: "everyone" | "mine"): Prisma.SalesOrganizationWhereInput {
  return visibleContactWhere(actor, scope);
}

/** The contact's owner or an admin may change it. */
export function canEditContact(actor: SalesActor, contact: { ownerId: string }): boolean {
  return actor.isAdmin || contact.ownerId === actor.userId;
}
