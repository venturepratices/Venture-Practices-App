import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import type { SalesActor } from "@/lib/sales/access";
import { autoTurnOff, BOT_ABUSE_LIMITS } from "@/lib/sales/bot-alerts";
import { alertOffKeyUsed, type BotCallInfo, logBotCall, logRefusedCall, noteAddress } from "@/lib/sales/bot-call-log";
import { bestEffort, countCall, countSignal, windowStarts } from "@/lib/sales/bot-counters";
import { botsEnabled, isAddressSlowed, recordBadKey } from "@/lib/sales/bot-guard";
import { BOT_LIMITS, BOT_SECRET_PREFIX, type BotScope } from "@/lib/sales/bot-scopes";

export { BOT_LIMITS, BOT_ROLE_PRESETS, BOT_ROLES, BOT_SCOPES, type BotRole, type BotScope } from "@/lib/sales/bot-scopes";
export type { BotCallInfo } from "@/lib/sales/bot-call-log";

// The scheme name is case-insensitive ("bearer" works too); the key itself is not.
const BEARER_PATTERN = /^bearer (\S+)$/i;
const SECRET_PATTERN = new RegExp(`^${BOT_SECRET_PREFIX}[A-Za-z0-9_-]{43}$`);
const LAST_USED_EVERY_MS = 60_000;

// Missing, malformed, unknown, turned-off, expired and must-rotate keys, and keys
// whose person lost Sales, all get this one message: a caller can't tell which check stopped them.
const INVALID_KEY = "Invalid bot key.";
const NOT_ALLOWED = "This bot is not allowed to do that.";

export type BotAuthResult = { ok: true; actor: SalesActor } | { ok: false; status: 401 | 403 | 429; error: string };

export function hashBotSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** A new bot key. Only `hash` and `last4` are stored; `secret` is shown once and then lost. */
export function generateBotSecret(): { secret: string; hash: string; last4: string } {
  const secret = BOT_SECRET_PREFIX + randomBytes(32).toString("base64url");
  return { secret, hash: hashBotSecret(secret), last4: secret.slice(-4) };
}

/** A signed-in person is limited by their capabilities; a bot also by its key's scopes. */
export function botCan(actor: SalesActor, scope: BotScope): boolean {
  if (actor.via !== "bot") return true;
  return actor.scopes?.includes(scope) ?? false;
}

/** The vpb_ key from an `Authorization: Bearer ...` header, or null when there isn't a well-formed one. */
function secretFromHeader(authorizationHeader: string | null): string | null {
  const secret = authorizationHeader ? BEARER_PATTERN.exec(authorizationHeader)?.[1] : undefined;
  return secret && SECRET_PATTERN.test(secret) ? secret : null;
}

const TOKEN_SELECT = {
  id: true,
  name: true,
  enabled: true,
  scopes: true,
  pipelineKeys: true,
  allPipelines: true,
  ownDealsOnly: true,
  mustRotate: true,
  expiresAt: true,
  lastUsedAt: true,
  lastUsedIp: true,
  knownIps: true,
  actingForId: true,
  actingFor: { select: { id: true, isAdmin: true, canUseSales: true, salesSeesAllDeals: true } },
} as const;

/**
 * Checks the `Authorization: Bearer vpb_...` header of a bot call, and that the
 * key's permissions cover `call.scope` (a null scope is a route bots may never
 * use). The person the bot works for is re-checked on every call, so a bot stops
 * the moment that person loses Sales. Every call by a known key is logged;
 * unknown keys write nothing. Refused keys are never counted against the limits.
 */
export async function authenticateBot(
  authorizationHeader: string | null,
  now: Date,
  call: BotCallInfo,
): Promise<BotAuthResult> {
  if (!botsEnabled()) return { ok: false, status: 403, error: "Bot keys are paused." };
  if (isAddressSlowed(call.ip, now)) {
    return { ok: false, status: 429, error: "Too many bad keys from this address. Try again in 10 minutes." };
  }

  const secret = secretFromHeader(authorizationHeader);
  const token = secret
    ? await prisma.botToken.findUnique({ where: { tokenHash: hashBotSecret(secret) }, select: TOKEN_SELECT })
    : null;
  if (!token) {
    recordBadKey(call.ip, now);
    return { ok: false, status: 401, error: INVALID_KEY };
  }

  // A refused call is logged (at most 20 rows per key per day, so a replayed key
  // cannot grow the log without end). Off, expired and over-limit refusals also
  // count against the caller's address, so replays get slowed like bad keys.
  const refuse = async (status: 401 | 403 | 429, error: string, slow = true): Promise<BotAuthResult> => {
    if (slow) recordBadKey(call.ip, now);
    await logRefusedCall(token.id, call, status, now);
    return { ok: false, status, error };
  };

  const person = token.actingFor;
  const expired = !token.expiresAt || token.expiresAt.getTime() <= now.getTime();
  if (!token.enabled || expired || token.mustRotate || (!person.isAdmin && !person.canUseSales)) {
    const result = await refuse(401, INVALID_KEY);
    await alertOffKeyUsed(token, now);
    return result;
  }

  const windows = windowStarts(now);
  const minuteCount = await countCall(token.id, "minute", windows.minute);
  if (minuteCount === null) return { ok: false, status: 401, error: INVALID_KEY };
  if (minuteCount > BOT_LIMITS.perMinute) {
    // Only the first refusal of a minute counts, so one busy minute is one signal.
    if (minuteCount === BOT_LIMITS.perMinute + 1) {
      const minutes = await countSignal(token.id, "limit-minutes", now);
      if (minutes >= BOT_ABUSE_LIMITS.limitMinutes) {
        await autoTurnOff(token, `it went over its call limit in ${minutes} different minutes today.`, now);
      }
    }
    return refuse(429, "Too many calls this minute. Try again in a minute.");
  }
  const dayCount = await countCall(token.id, "day", windows.day);
  if (dayCount === null) return { ok: false, status: 401, error: INVALID_KEY };
  if (dayCount > BOT_LIMITS.perDay) return refuse(429, "Daily call limit reached. Try again tomorrow (UTC).");

  if (call.scope === null || !token.scopes.includes(call.scope)) {
    const refused = await countSignal(token.id, "refused", now);
    if (refused >= BOT_ABUSE_LIMITS.refusedPerDay) {
      await autoTurnOff(token, `it asked ${refused} times today for things it is not allowed to do.`, now);
    }
    return refuse(403, NOT_ALLOWED, false);
  }

  await logBotCall(token.id, call, 200, now);
  await noteAddress(token, call.ip, now);
  if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() >= LAST_USED_EVERY_MS) {
    // updateMany, so a key deleted a moment ago is a no-op rather than an error.
    await bestEffort("lastUsedAt", () =>
      prisma.botToken.updateMany({ where: { id: token.id }, data: { lastUsedAt: now } }),
    );
    // Same once-a-minute beat: clear this key's finished windows so the table stays small.
    await bestEffort("old counters", () =>
      prisma.botTokenUsage.deleteMany({
        where: {
          tokenId: token.id,
          OR: [
            { kind: "minute", windowStart: { lt: windows.minute } },
            { kind: { not: "minute" }, windowStart: { lt: windows.day } },
          ],
        },
      }),
    );
  }

  return {
    ok: true,
    actor: {
      userId: person.id,
      // A bot never counts as an admin, even for an admin: what it can reach comes
      // from its person's who-can-see setting (and only their own deals unless the
      // bot is allowed more), what they own, the key's scopes and its pipelines.
      isAdmin: false,
      seesAllDeals: person.salesSeesAllDeals && !token.ownDealsOnly,
      via: "bot",
      botTokenId: token.id,
      scopes: token.scopes,
      pipelineKeys: token.pipelineKeys,
      allPipelines: token.allPipelines,
    },
  };
}
