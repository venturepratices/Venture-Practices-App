import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { isPrismaError } from "@/lib/prisma-errors";
import type { SalesActor } from "@/lib/sales/access";
import { BOT_LIMITS, BOT_SECRET_PREFIX, type BotScope } from "@/lib/sales/bot-scopes";

export { BOT_LIMITS, BOT_ROLE_PRESETS, BOT_ROLES, BOT_SCOPES, type BotRole, type BotScope } from "@/lib/sales/bot-scopes";

// The scheme name is case-insensitive ("bearer" works too); the key itself is not.
const BEARER_PATTERN = /^bearer (\S+)$/i;
const SECRET_PATTERN = new RegExp(`^${BOT_SECRET_PREFIX}[A-Za-z0-9_-]{43}$`);
const LAST_USED_EVERY_MS = 60_000;

// Missing, malformed and unknown keys all get this one message, so a caller
// can't tell which check stopped them.
const INVALID_KEY = "Invalid bot key.";

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

function windowStarts(now: Date): { minute: Date; day: Date } {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { minute, day };
}

/** The vpb_ key from an `Authorization: Bearer ...` header, or null when there isn't a well-formed one. */
function secretFromHeader(authorizationHeader: string | null): string | null {
  const secret = authorizationHeader ? BEARER_PATTERN.exec(authorizationHeader)?.[1] : undefined;
  return secret && SECRET_PATTERN.test(secret) ? secret : null;
}

/**
 * Adds one call to the key's counter for this window and returns the new count,
 * or null when the key was deleted while the call was being checked (its
 * counters go with it, so there is nothing left to count against).
 */
async function countCall(tokenId: string, kind: "minute" | "day", windowStart: Date): Promise<number | null> {
  const where = { tokenId_kind_windowStart: { tokenId, kind, windowStart } };
  const increment = { count: { increment: 1 } };
  try {
    const row = await prisma.botTokenUsage.upsert({
      where,
      create: { tokenId, kind, windowStart, count: 1 },
      update: increment,
      select: { count: true },
    });
    return row.count;
  } catch (error) {
    if (isPrismaError(error, "P2003")) return null;
    if (!isPrismaError(error, "P2002")) throw error;
  }
  // Two first calls in a new window both tried to create its counter and this one
  // lost. The row exists now, so add to it with one atomic UPDATE (count + 1).
  try {
    const row = await prisma.botTokenUsage.update({ where, data: increment, select: { count: true } });
    return row.count;
  } catch (error) {
    if (isPrismaError(error, "P2025")) return null;
    throw error;
  }
}

/** Bookkeeping only: a failure here must never turn an allowed call into an error. */
async function bestEffort(label: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (error) {
    console.warn(`Bot key bookkeeping failed (${label}):`, error);
  }
}

/**
 * Checks the `Authorization: Bearer vpb_...` header of a bot call and, if it may
 * go ahead, counts it against the key's limits. The person the bot works for is
 * re-checked on every call, so a bot stops the moment that person loses Sales.
 * A refused key (unknown, turned off, person without Sales) is never counted.
 */
export async function authenticateBot(authorizationHeader: string | null, now = new Date()): Promise<BotAuthResult> {
  const secret = secretFromHeader(authorizationHeader);
  if (!secret) return { ok: false, status: 401, error: INVALID_KEY };

  const token = await prisma.botToken.findUnique({
    where: { tokenHash: hashBotSecret(secret) },
    select: {
      id: true,
      enabled: true,
      scopes: true,
      pipelineKeys: true,
      lastUsedAt: true,
      actingFor: { select: { id: true, isAdmin: true, canUseSales: true, salesSeesAllDeals: true } },
    },
  });
  if (!token) return { ok: false, status: 401, error: INVALID_KEY };
  if (!token.enabled) return { ok: false, status: 401, error: "This bot is turned off." };

  const person = token.actingFor;
  if (!person.isAdmin && !person.canUseSales) {
    return { ok: false, status: 403, error: "The person this bot works for doesn't have access to Sales." };
  }

  const windows = windowStarts(now);
  const minuteCount = await countCall(token.id, "minute", windows.minute);
  if (minuteCount === null) return { ok: false, status: 401, error: INVALID_KEY };
  if (minuteCount > BOT_LIMITS.perMinute) {
    return { ok: false, status: 429, error: "Too many calls this minute. Try again in a minute." };
  }
  const dayCount = await countCall(token.id, "day", windows.day);
  if (dayCount === null) return { ok: false, status: 401, error: INVALID_KEY };
  if (dayCount > BOT_LIMITS.perDay) {
    return { ok: false, status: 429, error: "Daily call limit reached. Try again tomorrow (UTC)." };
  }

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
            { kind: "day", windowStart: { lt: windows.day } },
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
      // from its person's who-can-see setting, what they own, and the key's scopes.
      isAdmin: false,
      seesAllDeals: person.salesSeesAllDeals,
      via: "bot",
      botTokenId: token.id,
      scopes: token.scopes,
      pipelineKeys: token.pipelineKeys,
    },
  };
}
