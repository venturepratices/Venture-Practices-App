/**
 * Audit logging for the Marketing area.
 *
 * Writes to the shared ActivityLog table (see prisma/schema.prisma) so every
 * sensitive Marketing view is traceable to the actor + time. We piggyback on
 * ActivityLog instead of a Marketing-only table so the Activity page already
 * surfaces it and ops keeps one place to look.
 *
 * Design rules:
 *  - Every log call is wrapped in try/catch and NEVER throws — a logging
 *    outage must not take the page down.
 *  - Views are rate-limited per (actor, surface) via an in-memory TTL cache
 *    so an overexcited reload doesn't fill the table with duplicates. The
 *    cache is best-effort; the ActivityLog has its own indexes if we ever
 *    want stricter dedupe at the DB layer.
 *  - Action logs (writes) are NOT rate-limited — every write is recorded.
 *  - No PII, secrets, template bodies, or recipient data goes in `metadata`.
 *    Keep it to identifiers and short labels.
 */

import { logActivity } from "@/lib/activity-log";
import type { Prisma } from "@/generated/prisma/client";

const MARKETING_ENTITY_TYPE = "marketing";

/**
 * One row of in-memory per-process dedupe. Lives for the lifetime of the
 * Node process (one per Vercel instance). A cold start resets it, which is
 * fine — the audit log is a traceability aid, not a source of truth.
 */
const VIEW_DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const viewDedupe = new Map<string, number>();

function dedupeKey(actorId: string, surface: string): string {
  return `${actorId}::${surface}`;
}

function isRecentlyLogged(actorId: string, surface: string): boolean {
  const key = dedupeKey(actorId, surface);
  const last = viewDedupe.get(key);
  if (last === undefined) return false;
  if (Date.now() - last > VIEW_DEDUPE_WINDOW_MS) {
    viewDedupe.delete(key);
    return false;
  }
  return true;
}

function markLogged(actorId: string, surface: string): void {
  viewDedupe.set(dedupeKey(actorId, surface), Date.now());
  // Keep the cache bounded. 2000 entries is small; drop the oldest half if
  // we drift past it. Simple > exact under load.
  if (viewDedupe.size > 2000) {
    const half = Math.floor(viewDedupe.size / 2);
    const keys = [...viewDedupe.keys()].slice(0, half);
    for (const k of keys) viewDedupe.delete(k);
  }
}

/**
 * Supported Marketing surfaces. Keep this closed — every new surface has to
 * declare itself here so the audit log stays queryable by a known vocabulary.
 */
export type MarketingSurface =
  | "marketing.followup.view"
  | "marketing.stats.view"
  | "marketing.sync.view"
  | "marketing.email.view";

export interface MarketingActorHint {
  userId: string;
  name?: string | null;
}

/**
 * Record that `actor` viewed `surface`. Deduped per (actor, surface) within a
 * 5-minute window. Never throws.
 */
export async function logMarketingView(
  actor: MarketingActorHint,
  surface: MarketingSurface,
  metadata?: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    if (isRecentlyLogged(actor.userId, surface)) return;
    markLogged(actor.userId, surface);
    await logActivity({
      actorId: actor.userId,
      actorName: actor.name ?? null,
      entityType: MARKETING_ENTITY_TYPE,
      entityId: surface,
      entityLabel: surfaceLabel(surface),
      action: surface,
      description: `Viewed ${surfaceLabel(surface)}`,
      details: (metadata ?? {}) as Prisma.InputJsonValue,
    });
  } catch (error) {
    // Deliberately swallow — logging should never break a page render.
    console.error("[marketing/audit] view log failed", {
      surface,
      actorId: actor.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Record a Marketing action (a write). NOT deduped — every call is written.
 * Reserved for future PRs once the inline editor lands; included now so the
 * audit vocabulary is complete.
 */
export async function logMarketingAction(
  actor: MarketingActorHint,
  action: string,
  description: string,
  metadata?: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    await logActivity({
      actorId: actor.userId,
      actorName: actor.name ?? null,
      entityType: MARKETING_ENTITY_TYPE,
      entityId: action,
      entityLabel: action,
      action,
      description,
      details: (metadata ?? {}) as Prisma.InputJsonValue,
    });
  } catch (error) {
    console.error("[marketing/audit] action log failed", {
      action,
      actorId: actor.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function surfaceLabel(surface: MarketingSurface): string {
  switch (surface) {
    case "marketing.followup.view":
      return "Marketing · Follow-up system";
    case "marketing.stats.view":
      return "Marketing · Stats";
    case "marketing.sync.view":
      return "Marketing · Sync status";
    case "marketing.email.view":
      return "Marketing · Email detail";
  }
}
