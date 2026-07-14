import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/credential-crypto";

/**
 * HighLevel (LeadConnector) Conversations integration — read-only v1.
 *
 * We connect to one agency's own HighLevel account using a per-client Private
 * Integration Token (stored encrypted on ClientHighLevelConnection). This module
 * is the whole server-side surface: a thin API client, a defensive normalizer
 * (payload shapes vary and must never crash a sync), a sync-on-view helper, and
 * the storage guardrail (inline prune) that keeps our local cache bounded.
 *
 * HighLevel remains the system of record — ConversationMessage is only a lean
 * cache, so pruning it can never lose data (older history re-pulls on demand).
 */

const HL_BASE = "https://services.leadconnectorhq.com";
const HL_VERSION = "2021-07-28"; // required Version header for the v2 Conversations API

// --- Storage guardrail knobs (see the plan's "Automated storage guardrail"). ---
// Storage is bounded by construction: every sync prunes the client back within
// these limits, so the cache can't grow unbounded even if no cron ever runs.
export const RETENTION_DAYS = 180; // drop messages older than this
export const MAX_MESSAGES_PER_CLIENT = 2000; // hard ceiling on newest-kept rows per client

// --- Sync knobs. ---
export const SYNC_THROTTLE_MS = 60_000; // sync-on-view skips if we synced within this window
const MAX_CONVERSATIONS_PER_SYNC = 50; // bound the per-sync fan-out (lean cache)
const MAX_BODY_CHARS = 5000; // truncate long/HTML email bodies to keep storage small

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

async function hlFetch(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${HL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: HL_VERSION,
      Accept: "application/json",
    },
    // Conversations are time-sensitive; never serve a stale cached fetch.
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HighLevel API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

type HlConversation = {
  id: string;
  contactId?: string;
  contactName?: string;
  fullName?: string;
};

/** Recent conversations for a location (bounded — this is a lean cache, not a mirror). */
async function searchConversations(locationId: string, token: string): Promise<HlConversation[]> {
  const data = (await hlFetch(
    `/conversations/search?locationId=${encodeURIComponent(locationId)}&limit=${MAX_CONVERSATIONS_PER_SYNC}`,
    token
  )) as { conversations?: HlConversation[] } | null;
  return Array.isArray(data?.conversations) ? data.conversations : [];
}

/**
 * Validate a token + location before we persist them. Throws if HighLevel
 * rejects the token or the location is unreachable, so the connect route can
 * refuse to store a broken connection.
 */
export async function verifyHighLevelConnection(locationId: string, token: string): Promise<void> {
  await searchConversations(locationId, token);
}

/** Messages for one conversation. Tolerates the two response shapes HighLevel uses. */
async function getMessages(conversationId: string, token: string): Promise<unknown[]> {
  const data = (await hlFetch(`/conversations/${encodeURIComponent(conversationId)}/messages`, token)) as {
    messages?: unknown[] | { messages?: unknown[] };
  } | null;
  const m = data?.messages;
  if (Array.isArray(m)) return m;
  if (m && typeof m === "object" && Array.isArray((m as { messages?: unknown[] }).messages)) {
    return (m as { messages: unknown[] }).messages;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Normalizer — maps a raw HighLevel message (from the API OR, later, a webhook
// body) into our ConversationMessage shape. Written defensively: any single bad
// message returns null and is skipped rather than throwing the whole sync.
// ---------------------------------------------------------------------------

export type NormalizedMessage = {
  ghlMessageId: string;
  ghlConversationId: string | null;
  ghlContactId: string;
  contactName: string | null;
  channel: "SMS" | "Email" | "Call" | "Voicemail";
  direction: "inbound" | "outbound";
  subject: string | null;
  body: string;
  ghlTimestamp: Date;
};

/**
 * Bucket HighLevel's many message types into our tabs. Voicemail is its own
 * bucket (distinct from a plain Call) so it can be labeled and shown in the
 * Conversations timeline like HighLevel does; everything else that isn't SMS/
 * Email/Call/Voicemail (chat channels like WhatsApp/FB/IG) → SMS so it still
 * shows rather than vanishing.
 */
function bucketChannel(messageType: string): "SMS" | "Email" | "Call" | "Voicemail" {
  const t = messageType.toUpperCase();
  // Check voicemail/call BEFORE email — "VOICEMAIL" contains the substring
  // "EMAIL", so an email-first check would misclassify voicemails.
  if (t.includes("VOICEMAIL")) return "Voicemail";
  if (t.includes("CALL")) return "Call";
  if (t.includes("EMAIL")) return "Email";
  return "SMS";
}

/** Strip HTML and collapse whitespace so email bodies are stored as lean plain text. */
function toPlainText(input: string): string {
  const stripped = input
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > MAX_BODY_CHARS ? `${stripped.slice(0, MAX_BODY_CHARS)}…` : stripped;
}

export function normalizeMessage(raw: unknown, convo?: HlConversation): NormalizedMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;

  const id = m.id ?? m.messageId;
  if (!id) return null;

  const messageType = String(m.messageType ?? m.type ?? "");
  const dateStr = m.dateAdded ?? m.dateUpdated ?? m.createdAt;
  const parsed = dateStr ? new Date(String(dateStr)) : null;
  const ghlTimestamp = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);

  const meta = (m.meta as Record<string, unknown> | undefined) ?? undefined;
  const emailMeta = (meta?.email as Record<string, unknown> | undefined) ?? undefined;
  const subjectRaw = m.subject ?? emailMeta?.subject ?? null;
  const rawBody = m.body ?? emailMeta?.snippet ?? m.lastMessageBody ?? "";

  const ghlContactId = String(m.contactId ?? convo?.contactId ?? "");
  const contactName = convo?.contactName ?? convo?.fullName ?? null;

  return {
    ghlMessageId: String(id),
    ghlConversationId: convo?.id ?? null,
    ghlContactId,
    contactName: contactName ? String(contactName) : null,
    channel: bucketChannel(messageType),
    direction: m.direction === "outbound" ? "outbound" : "inbound",
    subject: subjectRaw ? String(subjectRaw) : null,
    body: toPlainText(String(rawBody)),
    ghlTimestamp,
  };
}

// ---------------------------------------------------------------------------
// Storage guardrail — inline prune. Runs on every sync; bounds each client's
// cache immediately so total storage can never run away.
// ---------------------------------------------------------------------------

export async function pruneClientConversations(clientId: string): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Layer 1: drop anything older than the retention window.
  const aged = await prisma.conversationMessage.deleteMany({
    where: { clientId, ghlTimestamp: { lt: cutoff } },
  });

  // Layer 2: hard ceiling — keep only the newest MAX_MESSAGES_PER_CLIENT rows.
  const excess = await prisma.conversationMessage.findMany({
    where: { clientId },
    orderBy: { ghlTimestamp: "desc" },
    skip: MAX_MESSAGES_PER_CLIENT,
    select: { id: true },
  });
  let cappedCount = 0;
  if (excess.length > 0) {
    const res = await prisma.conversationMessage.deleteMany({
      where: { id: { in: excess.map((e) => e.id) } },
    });
    cappedCount = res.count;
  }

  return aged.count + cappedCount;
}

/** Prune every connected client — used by the daily safety-net cron. */
export async function pruneAllConnectedClients(): Promise<Record<string, number>> {
  const connections = await prisma.clientHighLevelConnection.findMany({ select: { clientId: true } });
  const pruned: Record<string, number> = {};
  for (const conn of connections) {
    pruned[conn.clientId] = await pruneClientConversations(conn.clientId);
  }
  return pruned;
}

// ---------------------------------------------------------------------------
// Sync — pull recent messages for a client, upsert (deduped), then prune.
// ---------------------------------------------------------------------------

export type SyncResult =
  | { status: "synced"; upserted: number; pruned: number }
  | { status: "skipped"; reason: "not_connected" | "throttled" };

/**
 * Fetch recent conversations/messages for a client and upsert them, then prune.
 * Deduped on ghlMessageId so repeated syncs never create duplicates. Throttled
 * by lastSyncAt unless `force` is set (connect-time backfill and "Sync now" force).
 * Throws on HighLevel API errors so callers can surface a clear message; the
 * sync-on-view caller wraps this in try/catch and still renders the cache.
 */
export async function syncClientConversations(
  clientId: string,
  opts: { force?: boolean } = {}
): Promise<SyncResult> {
  const conn = await prisma.clientHighLevelConnection.findUnique({ where: { clientId } });
  if (!conn) return { status: "skipped", reason: "not_connected" };

  if (
    !opts.force &&
    conn.lastSyncAt &&
    Date.now() - conn.lastSyncAt.getTime() < SYNC_THROTTLE_MS
  ) {
    return { status: "skipped", reason: "throttled" };
  }

  const token = decryptSecret(conn.encryptedToken);
  const conversations = await searchConversations(conn.locationId, token);

  let upserted = 0;
  for (const convo of conversations) {
    const rawMessages = await getMessages(convo.id, token);
    for (const raw of rawMessages) {
      const norm = normalizeMessage(raw, convo);
      if (!norm) continue;
      await prisma.conversationMessage.upsert({
        where: { ghlMessageId: norm.ghlMessageId },
        create: { clientId, ...norm },
        update: {
          body: norm.body,
          subject: norm.subject,
          direction: norm.direction,
          contactName: norm.contactName,
          channel: norm.channel,
          ghlTimestamp: norm.ghlTimestamp,
          ghlConversationId: norm.ghlConversationId,
        },
      });
      upserted++;
    }
  }

  const pruned = await pruneClientConversations(clientId);
  await prisma.clientHighLevelConnection.update({
    where: { clientId },
    data: { lastSyncAt: new Date() },
  });

  return { status: "synced", upserted, pruned };
}

// ---------------------------------------------------------------------------
// TODO(send): future outbound-reply support. HighLevel's V2 Conversations API
// has POST /conversations/messages ("Send a new message") for SMS + email.
// Adding it here (encrypt/decrypt token flow is already in place) is the whole
// server-side change needed — the read-only v1 data model already fits.
// ---------------------------------------------------------------------------
