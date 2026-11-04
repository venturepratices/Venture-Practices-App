import { PermissionError, requireCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * Who is acting on Sales data. A person signed in through the app (`via: "user"`)
 * is limited only by their capabilities; a bot key (`via: "bot"`, added later)
 * also carries scopes.
 */
export type SalesActor = {
  userId: string;
  isAdmin: boolean;
  /** The who-can-see setting: false = this person sees only deals they own. */
  seesAllDeals: boolean;
  via: "user" | "bot";
  botTokenId?: string;
  scopes?: readonly string[];
};

const SALES_DENIED_MESSAGE = "You don't have access to Sales.";

/** Team members who can own deals and leads: admins and anyone with the Sales switch. */
export const SALES_MEMBER_WHERE = { OR: [{ isAdmin: true }, { canUseSales: true }] };

/**
 * Gate for every Sales route and page. Throws PermissionError (401 signed out,
 * 403 without Sales access) so `toErrorResponse` turns it into a JSON response.
 */
export async function requireSalesUser(): Promise<SalesActor> {
  const perms = await requireCapability("canUseSales").catch((error: unknown) => {
    // Keep 401 (signed out) as is; give a 403 the Sales-specific message.
    if (error instanceof PermissionError && error.status === 403) {
      throw new PermissionError(403, SALES_DENIED_MESSAGE);
    }
    throw error;
  });
  const row = await prisma.teamMember.findUnique({
    where: { id: perms.userId },
    select: { salesSeesAllDeals: true },
  });
  if (!row) throw new PermissionError(403, SALES_DENIED_MESSAGE);
  return { userId: perms.userId, isAdmin: perms.isAdmin, seesAllDeals: row.salesSeesAllDeals, via: "user" };
}

/**
 * `where` fragment for deal queries. "mine" always narrows to the actor's own
 * deals; "everyone" does too unless the actor is an admin or may see all deals.
 */
export function dealOwnerWhere(actor: SalesActor, scope: "everyone" | "mine"): { ownerId?: string } {
  if (scope === "mine" || (!actor.isAdmin && !actor.seesAllDeals)) return { ownerId: actor.userId };
  return {};
}

export function canEditDeal(actor: SalesActor, deal: { ownerId: string }): boolean {
  return actor.isAdmin || deal.ownerId === actor.userId;
}

/** Deleting Sales records is for signed-in admins only, never a bot key. */
export function canDeleteSalesRecords(actor: SalesActor): boolean {
  return actor.via === "user" && actor.isAdmin;
}
