import { PermissionError } from "@/lib/permissions";
import { requireSalesUser, type SalesActor } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import type { BotScope } from "@/lib/sales/bot-scopes";
import { countCall, windowStarts } from "@/lib/sales/bot-counters";
import { authenticateBot } from "@/lib/sales/bot-tokens";

// The one gate every Sales route calls first. Deny by default: a route names
// the permission a bot needs, or null when bots may never use it. A request
// carrying any bearer key is a bot call: a refused key never falls back to
// the browser's signed-in person.

const BEARER = /^\s*bearer\s/i;

export async function requireSalesActor(request: Request, scope: BotScope | null): Promise<SalesActor> {
  const authorization = request.headers.get("authorization");
  if (!authorization || !BEARER.test(authorization)) return requireSalesUser();

  const meta = requestMeta(request);
  const result = await authenticateBot(authorization, new Date(), {
    method: request.method,
    path: new URL(request.url).pathname,
    ip: meta.ipAddress,
    userAgent: meta.userAgent,
    scope,
  });
  if (!result.ok) throw new PermissionError(result.status, result.error);
  return result.actor;
}

/** Records one bot key may read in one UTC day, across every read route. */
export const BOT_ROWS_PER_DAY = 5000;

/**
 * Counts the records a read route is about to hand a bot, and refuses (429)
 * when that would pass today's cap, so a leaked key cannot copy everything.
 * People are never counted.
 */
export async function chargeBotRows(actor: SalesActor, rows: number, now = new Date()): Promise<void> {
  if (actor.via !== "bot" || rows <= 0) return;
  const total = await countCall(actor.botTokenId, "rows", windowStarts(now).day, rows);
  if (total !== null && total > BOT_ROWS_PER_DAY) {
    throw new PermissionError(429, "This bot has read its limit of records for today. Try again tomorrow (UTC).");
  }
}
