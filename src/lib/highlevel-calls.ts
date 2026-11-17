import { prisma } from "@/lib/prisma";
import type { ClientHighLevelConnection } from "@/generated/prisma/client";

/**
 * HighLevel Calls — detail layer.
 *
 * HighLevel's per-message endpoint (`/conversations/{id}/messages`) is silently
 * blocked by the HIPAA flag on client sub-accounts: the response comes back
 * with zero messages. Robert's weekly call reports need duration, answered vs
 * missed, which tracking number was dialed, and first-time vs repeat caller.
 * Of those, duration is not exposed anywhere else on the v2 API; the other
 * three are all available on the conversation search response itself.
 *
 * So this module pulls `/conversations/search`, extracts the call-level
 * fields HighLevel puts on each conversation, and upserts them into
 * `HighLevelCallSummary` keyed by `ghlConversationId`. Reads are derived
 * from this table, not from HighLevel's API, which is the whole point:
 * Muse reads through the app, past the HIPAA wall.
 *
 * See scratch/LEDGER.md Rulings 1-3 for the field-shape and granularity
 * decisions.
 */

const HL_BASE = "https://services.leadconnectorhq.com";
const HL_VERSION = "2021-07-28";
const PAGE_LIMIT = 100;
const MAX_PAGES_PER_SYNC = 10; // cap at 1000 conversations per sync; dense sub-accounts page more frequently
export const CALLS_SYNC_THROTTLE_MS = 60_000;

/** The subset of HL conversation fields we read. Everything else is ignored. */
type HlConversation = {
  id?: string;
  contactId?: string;
  contactName?: string | null;
  phone?: string | null;
  type?: string;
  lastMessageType?: string;
  lastMessageDirection?: string;
  lastMessageDate?: number;
  lastCallStatus?: string | null;
  lastCallTimestamp?: number | null;
  lastChannelAccount?: Array<{ value?: string | null } | null>;
};

async function hlFetch(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${HL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: HL_VERSION,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HighLevel API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * The parsed, call-shaped record we store. Pure: no DB, no I/O. One row per
 * HL conversation; keeps the LATEST call's status + tracking number + timing.
 * Non-call conversations (pure SMS, pure email) are filtered out before reach.
 */
export type CallRecord = {
  ghlConversationId: string;
  ghlContactId: string;
  contactName: string | null;
  callerPhone: string | null;
  trackingNumber: string | null;
  direction: string | null;
  status: string | null;
  lastCallAt: Date | null;
  lastMessageType: string | null;
};

/**
 * Pulls a single call record out of a raw HL conversation, or returns null
 * when the conversation has no call activity. Defensive about missing fields:
 * HighLevel's payload shape varies (and may vary further over time), so we
 * never throw on an odd row — we just drop it.
 */
export function parseConversationToCall(raw: unknown): CallRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as HlConversation;
  if (!c.id || !c.contactId) return null;
  // We only care about conversations whose latest activity was a call or
  // voicemail; SMS/email/chat conversations are tracked elsewhere (or not
  // at all in v1).
  const lastType = (c.lastMessageType ?? "").toString().toUpperCase();
  const hasCallActivity = lastType.includes("CALL") || lastType.includes("VOICEMAIL") || (c.lastCallTimestamp ?? null) !== null;
  if (!hasCallActivity) return null;

  const tracking = c.lastChannelAccount?.[0]?.value ?? null;
  // Keep only phone-looking tracking numbers (E.164). HL occasionally puts
  // non-phone identifiers (emails, opaque ids) in this field for non-phone
  // channels; we ignore those at display time.
  const trackingNumber = tracking && /^\+?\d{6,}$/.test(tracking) ? tracking : tracking;

  const lastCallAt = c.lastCallTimestamp
    ? new Date(c.lastCallTimestamp)
    : c.lastMessageDate
      ? new Date(c.lastMessageDate)
      : null;

  return {
    ghlConversationId: c.id,
    ghlContactId: c.contactId,
    contactName: c.contactName ?? null,
    callerPhone: c.phone ?? null,
    trackingNumber,
    direction: c.lastMessageDirection ?? null,
    status: c.lastCallStatus ?? null,
    lastCallAt,
    lastMessageType: c.lastMessageType ?? null,
  };
}

/** Pages through `/conversations/search` until an empty page or the cap. */
async function fetchAllCallConversations(locationId: string, token: string): Promise<CallRecord[]> {
  const out: CallRecord[] = [];
  let startAfterDate: number | null = null;
  for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
    const qs = new URLSearchParams({ locationId, limit: String(PAGE_LIMIT) });
    if (startAfterDate) qs.set("startAfterDate", String(startAfterDate));
    const res = (await hlFetch(`/conversations/search?${qs.toString()}`, token)) as {
      conversations?: unknown[];
    } | null;
    const list = Array.isArray(res?.conversations) ? res!.conversations! : [];
    if (list.length === 0) break;
    for (const raw of list) {
      const call = parseConversationToCall(raw);
      if (call) out.push(call);
    }
    if (list.length < PAGE_LIMIT) break;
    const last = list[list.length - 1] as HlConversation | undefined;
    if (!last?.lastMessageDate) break;
    startAfterDate = last.lastMessageDate;
  }
  return out;
}

/**
 * Pull recent HighLevel calls for one client, upsert them into
 * HighLevelCallSummary. Dedupes on ghlConversationId so repeated syncs don't
 * create duplicate rows; preserves firstSeenAt across upserts so first-time
 * vs repeat caller logic can trust it.
 *
 * Throws on HL API errors (403, 401, network); the caller (sync-on-view, cron)
 * wraps in try/catch and still renders the existing cache.
 */
export async function syncHighLevelCalls(
  conn: Pick<ClientHighLevelConnection, "clientId" | "locationId">,
  token: string,
): Promise<{ upserted: number; seen: number }> {
  const records = await fetchAllCallConversations(conn.locationId, token);
  let upserted = 0;
  for (const rec of records) {
    await prisma.highLevelCallSummary.upsert({
      where: { ghlConversationId: rec.ghlConversationId },
      create: {
        clientId: conn.clientId,
        ghlConversationId: rec.ghlConversationId,
        ghlContactId: rec.ghlContactId,
        contactName: rec.contactName,
        callerPhone: rec.callerPhone,
        trackingNumber: rec.trackingNumber,
        direction: rec.direction,
        status: rec.status,
        lastCallAt: rec.lastCallAt,
        lastMessageType: rec.lastMessageType,
      },
      update: {
        contactName: rec.contactName,
        callerPhone: rec.callerPhone,
        trackingNumber: rec.trackingNumber,
        direction: rec.direction,
        status: rec.status,
        lastCallAt: rec.lastCallAt,
        lastMessageType: rec.lastMessageType,
      },
    });
    upserted += 1;
  }
  return { upserted, seen: records.length };
}

// ---------------------------------------------------------------------------
// Read helpers — power the Calls view and Muse's /api read endpoints.
// Query from our DB, never HighLevel at read time.
// ---------------------------------------------------------------------------

export type CallsWindowStats = {
  totalCalls: number;
  answered: number;
  missed: number;
  firstTimeCallers: number;
  repeatCallers: number;
  byTrackingNumber: Array<{ number: string; label: string | null; count: number }>;
};

/**
 * Stats for the Calls view's summary tiles and tracking-number breakdown.
 * `start` is inclusive, `end` is exclusive. clientIds narrows to a subset;
 * leave empty/undefined to include every client the caller can read.
 *
 * "First-time caller": a callerPhone whose earliest `firstSeenAt` is inside
 * the window. "Repeat caller": firstSeenAt before the window.
 */
export async function getCallsStatsForWindow(
  args: { clientIds?: string[]; start: Date; end: Date },
): Promise<CallsWindowStats> {
  const where = {
    lastCallAt: { gte: args.start, lt: args.end },
    ...(args.clientIds && args.clientIds.length > 0 ? { clientId: { in: args.clientIds } } : {}),
  };
  const [rows, trackingMap] = await Promise.all([
    prisma.highLevelCallSummary.findMany({
      where,
      select: {
        callerPhone: true,
        firstSeenAt: true,
        status: true,
        trackingNumber: true,
        clientId: true,
      },
    }),
    args.clientIds && args.clientIds.length > 0
      ? prisma.highLevelTrackingNumber.findMany({
          where: { clientId: { in: args.clientIds } },
          select: { clientId: true, number: true, label: true },
        })
      : prisma.highLevelTrackingNumber.findMany({ select: { clientId: true, number: true, label: true } }),
  ]);

  const labelLookup = new Map<string, string>();
  for (const t of trackingMap) labelLookup.set(`${t.clientId}:${t.number}`, t.label);

  let answered = 0;
  let missed = 0;
  let firstTime = 0;
  let repeat = 0;
  const byNum = new Map<string, { number: string; label: string | null; count: number }>();

  for (const r of rows) {
    const status = (r.status ?? "").toLowerCase();
    if (status === "completed") answered += 1;
    else if (status === "no-answer" || status === "busy" || status === "failed") missed += 1;

    if (r.firstSeenAt >= args.start && r.firstSeenAt < args.end) firstTime += 1;
    else repeat += 1;

    const num = r.trackingNumber ?? "(unknown)";
    const label = labelLookup.get(`${r.clientId}:${num}`) ?? null;
    const prev = byNum.get(num);
    if (prev) prev.count += 1;
    else byNum.set(num, { number: num, label, count: 1 });
  }

  return {
    totalCalls: rows.length,
    answered,
    missed,
    firstTimeCallers: firstTime,
    repeatCallers: repeat,
    byTrackingNumber: [...byNum.values()].sort((a, b) => b.count - a.count),
  };
}
