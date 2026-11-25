import { PermissionError, requireCapability } from "@/lib/permissions";

/** Who is acting in the Marketing area. Signed-in people only, no bot keys. */
export type MarketingActor = { userId: string; isAdmin: boolean };

const MARKETING_DENIED_MESSAGE = "You don't have access to Marketing.";

/**
 * Server gate for every Marketing route and page. Throws PermissionError (401
 * signed out, 403 without the Marketing switch) so `toErrorResponse` can turn
 * it into a JSON response.
 */
export async function requireMarketingUser(): Promise<MarketingActor> {
  const perms = await requireCapability("canUseMarketing").catch((error: unknown) => {
    // Keep 401 (signed out) as is; give a 403 the Marketing-specific message.
    if (error instanceof PermissionError && error.status === 403) {
      throw new PermissionError(403, MARKETING_DENIED_MESSAGE);
    }
    throw error;
  });
  return { userId: perms.userId, isAdmin: perms.isAdmin };
}
