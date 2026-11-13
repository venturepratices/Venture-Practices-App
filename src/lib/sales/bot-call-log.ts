import { prisma } from "@/lib/prisma";
import { alertAdmins } from "@/lib/sales/bot-alerts";

// The usage log for bot keys: one BotCallLog row per call a known key makes
// (which key, when, what, from where, the result). Never the key or its hash.
// Unknown keys write nothing, so a flood of bad keys costs no database writes.
// Every write here is best effort: bookkeeping never fails a call.

export type BotCallInfo = {
  method: string;
  path: string;
  ip: string | null;
  userAgent: string | null;
  /** The permission the route needs; null for a route bots may never use. */
  scope: string | null;
};

const MAX_TEXT = 255;
const MAX_KNOWN_IPS = 20;

const cap = (value: string | null | undefined) => (value ? value.slice(0, MAX_TEXT) : null);

async function bestEffort(label: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (error) {
    console.warn(`Bot key bookkeeping failed (${label}):`, error instanceof Error ? error.message : "unknown error");
  }
}

export async function logBotCall(tokenId: string, call: BotCallInfo, status: number, now: Date): Promise<void> {
  await bestEffort("call log", () =>
    prisma.botCallLog.create({
      data: {
        tokenId,
        at: now,
        method: cap(call.method) ?? "?",
        path: cap(call.path) ?? "?",
        scope: cap(call.scope),
        status,
        ipAddress: cap(call.ip),
        userAgent: cap(call.userAgent),
      },
    }),
  );
}

const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Tells admins the first time today that a turned-off (or expired, or paused-for-rotation) key was used. */
export async function alertOffKeyUsed(bot: { id: string; name: string }, now: Date): Promise<void> {
  await bestEffort("off-key alert", async () => {
    const earlier = await prisma.botCallLog.count({ where: { tokenId: bot.id, status: 401, at: { gte: dayStart(now) } } });
    // The refused call itself is logged just before this, so 1 means "first today".
    if (earlier <= 1) {
      await alertAdmins(bot, `Someone used the key of the bot "${bot.name}", which is turned off, expired or no longer allowed. The call was refused.`);
    }
  });
}

/** Remembers a new address for the key, sets it as the last one, and tells admins. */
export async function noteAddress(
  bot: { id: string; name: string; knownIps: string[]; lastUsedIp: string | null },
  ip: string | null,
): Promise<void> {
  const address = cap(ip);
  if (!address) return;
  if (bot.knownIps.includes(address)) {
    if (bot.lastUsedIp !== address) {
      await bestEffort("last IP", () => prisma.botToken.updateMany({ where: { id: bot.id }, data: { lastUsedIp: address } }));
    }
    return;
  }
  const knownIps = [...bot.knownIps, address].slice(-MAX_KNOWN_IPS);
  await bestEffort("new IP", () => prisma.botToken.updateMany({ where: { id: bot.id }, data: { knownIps, lastUsedIp: address } }));
  await alertAdmins(bot, `The bot "${bot.name}" was used from a new address (${address}). If you did not expect this, turn it off.`);
}
