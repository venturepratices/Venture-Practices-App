import { prisma } from "@/lib/prisma";
import { isPrismaError } from "@/lib/prisma-errors";

// The per-key counters behind the call limits and the abuse signals, one
// BotTokenUsage row per key, kind and window. Kinds: "minute" and "day" for the
// limits, "limit-minutes" and "refused" (day windows) for the abuse signals, and
// "rows" (day windows) for how many records a bot has read today, "refused-log"
// for how many refused calls were logged today and "ip-alerts" for new-address alerts.

export type CounterKind = "minute" | "day" | "limit-minutes" | "refused" | "rows" | "refused-log" | "ip-alerts";

export function windowStarts(now: Date): { minute: Date; day: Date } {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { minute, day };
}

/**
 * Adds one to the key's counter for this window and returns the new count,
 * or null when the key was deleted while the call was being checked (its
 * counters go with it, so there is nothing left to count against).
 */
export async function countCall(tokenId: string, kind: CounterKind, windowStart: Date, by = 1): Promise<number | null> {
  const where = { tokenId_kind_windowStart: { tokenId, kind, windowStart } };
  const increment = { count: { increment: by } };
  try {
    const row = await prisma.botTokenUsage.upsert({
      where,
      create: { tokenId, kind, windowStart, count: by },
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
export async function bestEffort(label: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (error) {
    console.warn(`Bot key bookkeeping failed (${label}):`, error);
  }
}

/** Counts an abuse signal for today; returns the new count, or 0 when it could not be counted. */
export async function countSignal(
  tokenId: string,
  kind: "limit-minutes" | "refused" | "refused-log" | "ip-alerts",
  now: Date,
): Promise<number> {
  try {
    return (await countCall(tokenId, kind, windowStarts(now).day)) ?? 0;
  } catch (error) {
    console.warn(`Bot key bookkeeping failed (${kind}):`, error instanceof Error ? error.message : "unknown error");
    return 0;
  }
}
