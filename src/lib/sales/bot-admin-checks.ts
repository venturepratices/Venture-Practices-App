import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { BOT_CAPS, BOT_KEY_MAX_DAYS } from "@/lib/sales/bot-scopes";

// The checks the admin Bots routes run before a key is made, rotated or turned
// on: the admin types their password again, the bot limits per person and in
// total, and the plain-words refusals the screen shows.

export const PAUSED_MESSAGE =
  "Bot keys are paused. Ask whoever runs the app's hosting to switch them on (SALES_BOTS_ENABLED) once the key checklist is done.";
export const WRONG_PASSWORD = "That password is not right.";
export const PASSWORD_NEEDED = "Type your password to do this.";
export const NO_PIPELINES = "Pick at least one pipeline, or all pipelines.";
export const ROTATE_FIRST = "Rotate this bot's key before turning it on. Its key came back from a backup.";

/** The key's end time, `days` from now (at most 90). */
export function expiryFrom(now: Date, days: number = BOT_KEY_MAX_DAYS): Date {
  const safeDays = Math.min(Math.max(Math.floor(days), 1), BOT_KEY_MAX_DAYS);
  return new Date(now.getTime() + safeDays * 86_400_000);
}

/** True when `password` is the signed-in admin's own password. */
export async function checkAdminPassword(userId: string, password: string): Promise<boolean> {
  const me = await prisma.teamMember.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!me?.passwordHash) return false;
  return bcrypt.compare(password, me.passwordHash);
}

/** A plain refusal when one more bot for this person would pass a limit, else null. */
export async function checkBotCaps(actingForId: string): Promise<string | null> {
  const [forPerson, total] = await Promise.all([
    prisma.botToken.count({ where: { actingForId } }),
    prisma.botToken.count(),
  ]);
  if (forPerson >= BOT_CAPS.perPerson) return `This person already has ${BOT_CAPS.perPerson} bots. Delete one first.`;
  if (total >= BOT_CAPS.total) return `There are already ${BOT_CAPS.total} bots. Delete one first.`;
  return null;
}
