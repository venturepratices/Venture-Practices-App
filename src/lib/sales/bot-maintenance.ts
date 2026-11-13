import { prisma } from "@/lib/prisma";
import { alertAdmins } from "@/lib/sales/bot-alerts";

// The daily bot job (src/app/api/cron/bot-maintenance): keeps the call log to
// 90 days, and tells admins once, in the app only, when a key that is on will
// stop working within 7 days, so it can be rotated in time.

const DAY = 86_400_000;
export const CALL_LOG_DAYS = 90;
export const EXPIRY_WARNING_DAYS = 7;

export async function runBotMaintenance(now = new Date()): Promise<{ trimmed: number; warned: number }> {
  const { count: trimmed } = await prisma.botCallLog.deleteMany({
    where: { at: { lt: new Date(now.getTime() - CALL_LOG_DAYS * DAY) } },
  });

  const soon = await prisma.botToken.findMany({
    where: {
      enabled: true,
      expiryWarnedAt: null,
      expiresAt: { lte: new Date(now.getTime() + EXPIRY_WARNING_DAYS * DAY), gt: now },
    },
    select: { id: true, name: true, expiresAt: true },
  });
  for (const bot of soon) {
    const daysLeft = Math.max(1, Math.ceil(((bot.expiresAt as Date).getTime() - now.getTime()) / DAY));
    await alertAdmins(bot, `The key of the bot "${bot.name}" expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Rotate it to keep it working.`);
    await prisma.botToken.updateMany({ where: { id: bot.id }, data: { expiryWarnedAt: now } });
  }
  return { trimmed, warned: soon.length };
}
