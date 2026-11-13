import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { BOT_CAPS, BOT_KEY_MAX_DAYS } from "@/lib/sales/bot-scopes";

export { widensBot } from "@/lib/sales/bot-draft";

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

// Wrong-password strikes per admin, so the re-check cannot be guessed at by
// someone holding a stolen admin session. In this server's memory, bounded.
export const PASSWORD_LOCKED = "Too many wrong passwords. Try again in 15 minutes.";
const MAX_WRONG = 5;
const LOCK_MS = 15 * 60_000;
const MAX_TRACKED = 1000;
const strikes = new Map<string, { count: number; first: number; lockedUntil: number }>();

/** Tests only: forget every strike. */
export function resetPasswordStrikes(): void {
  strikes.clear();
}

/**
 * The password check every Bots route uses: refuses (429) after 5 wrong tries
 * in 15 minutes, even when the next try is right; a right password clears the count.
 */
export async function verifyAdminPassword(
  userId: string,
  password: string | undefined,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; status: 400 | 403 | 429; error: string }> {
  const strike = strikes.get(userId);
  if (strike && strike.lockedUntil > now) return { ok: false, status: 429, error: PASSWORD_LOCKED };
  // An old window (or a lock that has run out) starts again from nothing.
  if (strike && (strike.lockedUntil > 0 || now - strike.first >= LOCK_MS)) strikes.delete(userId);
  if (!password) return { ok: false, status: 400, error: PASSWORD_NEEDED };
  if (await checkAdminPassword(userId, password)) {
    strikes.delete(userId);
    return { ok: true };
  }
  const current = strikes.get(userId);
  if (current) current.count += 1;
  else {
    if (strikes.size >= MAX_TRACKED) strikes.delete(strikes.keys().next().value as string);
    strikes.set(userId, { count: 1, first: now, lockedUntil: 0 });
  }
  const updated = strikes.get(userId)!;
  if (updated.count >= MAX_WRONG) updated.lockedUntil = now + LOCK_MS;
  return { ok: false, status: 403, error: WRONG_PASSWORD };
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
