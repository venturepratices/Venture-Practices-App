import type { Prisma } from "@/generated/prisma/client";
import type { SalesActor } from "@/lib/sales/access";

/** Who made a change when it was not a person or a bot key: a rule, a webhook, or a data import. */
export type SalesSystemActor = { system: "rule" | "webhook" | "import" };

export type SalesAuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  before?: object;
  after?: object;
};

/**
 * Adds one row to the locked history log, inside the caller's transaction so the
 * change and its history commit or roll back together. A bot is logged as BOT
 * under the person it works for; rules and imports are SYSTEM with no person.
 */
export async function recordSalesAudit(
  tx: Prisma.TransactionClient,
  actor: SalesActor | SalesSystemActor,
  entry: SalesAuditEntry,
): Promise<void> {
  const who =
    "system" in actor
      ? { actorType: actor.system === "webhook" ? ("WEBHOOK" as const) : ("SYSTEM" as const), actorId: null, botTokenId: null }
      : actor.via === "bot"
        ? { actorType: "BOT" as const, actorId: actor.userId, botTokenId: actor.botTokenId ?? null }
        : { actorType: "USER" as const, actorId: actor.userId, botTokenId: null };

  await tx.salesAuditLog.create({
    data: {
      ...who,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: entry.before as Prisma.InputJsonObject | undefined,
      after: entry.after as Prisma.InputJsonObject | undefined,
    },
  });
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  if (Array.isArray(a) !== Array.isArray(b) || aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/**
 * The before/after pair for an edit, reduced to the keys that actually changed.
 * `updatedAt` always moves on a save, so it is left out as noise.
 */
export function auditDiff(before: object, after: object): { before: object; after: object } {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (key === "updatedAt" || isEqual(b[key], a[key])) continue;
    if (key in b) changedBefore[key] = b[key];
    if (key in a) changedAfter[key] = a[key];
  }
  return { before: changedBefore, after: changedAfter };
}
