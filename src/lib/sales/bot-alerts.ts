import { prisma } from "@/lib/prisma";
import type { SalesActor } from "@/lib/sales/access";
import { recordSalesAudit } from "@/lib/sales/audit";

// What happens when a bot key misbehaves: admins are told, in the app only
// (a Notification row written here directly, never Slack, email or a digest,
// and never to anyone who is not an admin), and a bot that keeps misbehaving
// is turned off by itself, with the reason kept on the bot and in its history.

/** How much misbehaviour in one UTC day turns a bot off by itself. */
export const BOT_ABUSE_LIMITS = {
  /** Different minutes in which it went over the per-minute call limit. */
  limitMinutes: 5,
  /** Calls refused because its permissions did not cover them. */
  refusedPerDay: 20,
};

export const BOTS_SCREEN_PATH = "/sales/settings/bots";

export type AlertBot = { id: string; name: string; actingForId: string };

/** One in-app notification to every admin. Best effort: never fails the call that raised it. */
export async function alertAdmins(bot: { id: string; name: string }, message: string): Promise<void> {
  try {
    const admins = await prisma.teamMember.findMany({ where: { isAdmin: true }, select: { id: true } });
    if (admins.length === 0) return;
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        recipientId: admin.id,
        type: "BOT_ALERT" as const,
        entityType: "BotToken",
        entityId: bot.id,
        entityLabel: bot.name.slice(0, 80),
        message,
        linkPath: BOTS_SCREEN_PATH,
      })),
    });
  } catch (error) {
    console.warn("Bot alert could not be written:", error instanceof Error ? error.message : "unknown error");
  }
}

/**
 * Turns the bot off, keeps the reason, writes it to the bot's history (so its
 * Recent activity shows it) and tells admins. Only the first of two racing
 * calls does this: the update matches only while the bot is still on.
 */
export async function autoTurnOff(bot: AlertBot, reason: string, now: Date): Promise<void> {
  try {
    const { count } = await prisma.botToken.updateMany({
      where: { id: bot.id, enabled: true },
      data: { enabled: false, offReason: reason, offAt: now },
    });
    if (count === 0) return;
    const actor: SalesActor = { userId: bot.actingForId, isAdmin: false, seesAllDeals: false, via: "bot", botTokenId: bot.id };
    await recordSalesAudit(prisma as never, actor, {
      entityType: "BotToken",
      entityId: bot.id,
      action: "auto_turned_off",
      after: { enabled: false, offReason: reason },
    });
    await alertAdmins(bot, `The app turned off the bot "${bot.name}": ${reason} Check it before turning it back on.`);
  } catch (error) {
    console.warn("Bot could not be turned off:", error instanceof Error ? error.message : "unknown error");
  }
}
