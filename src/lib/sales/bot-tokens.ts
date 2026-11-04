import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import type { SalesActor } from "@/lib/sales/access";
import { BOT_LIMITS, BOT_SECRET_PREFIX, type BotScope } from "@/lib/sales/bot-scopes";

export { BOT_LIMITS, BOT_ROLE_PRESETS, BOT_ROLES, BOT_SCOPES, type BotRole, type BotScope } from "@/lib/sales/bot-scopes";

const BEARER_PATTERN = new RegExp(`^Bearer (${BOT_SECRET_PREFIX}[A-Za-z0-9_-]{43})$`);
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

async function countCall(tokenId: string, kind: "minute" | "day", windowStart: Date): Promise<number> {
  const row = await prisma.botTokenUsage.upsert({
    where: { tokenId_kind_windowStart: { tokenId, kind, windowStart } },
    create: { tokenId, kind, windowStart, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  return row.count;
}

/**
 * Checks the `Authorization: Bearer vpb_...` header of a bot call and, if it may
 * go ahead, counts it against the key's limits. The person the bot works for is
 * re-checked on every call, so a bot stops the moment that person loses Sales.
 */
export async function authenticateBot(authorizationHeader: string | null, now = new Date()): Promise<BotAuthResult> {
  const match = authorizationHeader ? BEARER_PATTERN.exec(authorizationHeader) : null;
  if (!match) return { ok: false, status: 401, error: INVALID_KEY };

  const token = await prisma.botToken.findUnique({
    where: { tokenHash: hashBotSecret(match[1]) },
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
  if ((await countCall(token.id, "minute", windows.minute)) > BOT_LIMITS.perMinute) {
    return { ok: false, status: 429, error: "Too many calls this minute. Try again in a minute." };
  }
  if ((await countCall(token.id, "day", windows.day)) > BOT_LIMITS.perDay) {
    return { ok: false, status: 429, error: "Daily call limit reached. Try again tomorrow (UTC)." };
  }

  if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() >= LAST_USED_EVERY_MS) {
    await prisma.botToken.update({ where: { id: token.id }, data: { lastUsedAt: now } });
    // Same once-a-minute beat: clear this key's finished windows so the table stays small.
    await prisma.botTokenUsage.deleteMany({
      where: {
        tokenId: token.id,
        OR: [
          { kind: "minute", windowStart: { lt: windows.minute } },
          { kind: "day", windowStart: { lt: windows.day } },
        ],
      },
    });
  }

  return {
    ok: true,
    actor: {
      userId: person.id,
      isAdmin: person.isAdmin,
      seesAllDeals: person.salesSeesAllDeals,
      via: "bot",
      botTokenId: token.id,
      scopes: token.scopes,
      pipelineKeys: token.pipelineKeys,
    },
  };
}
