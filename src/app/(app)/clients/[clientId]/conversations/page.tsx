import Link from "next/link";
import { Mail, MessageSquare, Phone, Voicemail } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { syncClientConversations } from "@/lib/highlevel";
import { cn } from "@/lib/utils";
import { ConversationDetailThread, type ThreadMessage } from "@/components/clients/conversation-thread";
import { SyncNowButton } from "@/components/clients/sync-now-button";

type ContactSummary = {
  contactId: string;
  contactName: string | null;
  lastChannel: string;
  lastDirection: string;
  lastSubject: string | null;
  lastBody: string;
  lastTimestamp: string;
  messages: ThreadMessage[]; // chronological ascending — the full thread
};

function initialOf(name: string | null) {
  return name?.trim()?.[0]?.toUpperCase() ?? "?";
}

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ contactId?: string }>;
}) {
  const { clientId } = await params;
  const { contactId: requestedContactId } = await searchParams;

  const connection = await prisma.clientHighLevelConnection.findUnique({ where: { clientId } });
  if (!connection) {
    return (
      <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
        HighLevel isn&apos;t connected for this client yet.{" "}
        <Link href={`/clients/${clientId}`} className="text-primary underline-offset-4 hover:underline">
          Connect it on the Info tab
        </Link>{" "}
        to see conversations here.
      </div>
    );
  }

  // Sync-on-view (throttled internally by lastSyncAt). Never let a HighLevel
  // hiccup blank the page — fall back to the cached messages on failure.
  let syncFailed = false;
  try {
    await syncClientConversations(clientId);
  } catch {
    syncFailed = true;
  }

  // Everything — SMS, Email, Call, Voicemail — in one unified timeline, like
  // HighLevel's own Conversations tab. Already sorted newest-first, so each
  // contact's FIRST-encountered message below is automatically their most
  // recent one — the map's insertion order is therefore already "most
  // recently active contact first," no extra sort.
  const messages = await prisma.conversationMessage.findMany({
    where: { clientId },
    orderBy: { ghlTimestamp: "desc" },
  });

  const byContact = new Map<string, ContactSummary>();
  for (const m of messages) {
    // Prefer the real contact id; fall back to the conversation id (shared by
    // every message pulled from the same HighLevel conversation) rather than
    // the message's own id — falling back to a per-message id would split a
    // single real conversation into one row per message whenever HighLevel
    // omits contactId (seen on some automated/system conversations), which is
    // exactly what made outbound replies look "missing": each one landed in
    // its own single-message row instead of merging with the rest.
    const key = m.ghlContactId || m.ghlConversationId || m.id;
    const existing = byContact.get(key);
    const threadMsg: ThreadMessage = {
      id: m.id,
      channel: m.channel,
      direction: m.direction,
      subject: m.subject,
      body: m.body,
      ghlTimestamp: m.ghlTimestamp.toISOString(),
    };
    if (!existing) {
      byContact.set(key, {
        contactId: key,
        contactName: m.contactName,
        lastChannel: m.channel,
        lastDirection: m.direction,
        lastSubject: m.subject,
        lastBody: m.body,
        lastTimestamp: m.ghlTimestamp.toISOString(),
        messages: [threadMsg],
      });
    } else {
      existing.messages.push(threadMsg);
    }
  }
  const contacts = [...byContact.values()].map((c) => ({ ...c, messages: [...c.messages].reverse() }));

  const selected = contacts.find((c) => c.contactId === requestedContactId) ?? contacts[0] ?? null;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <p className="text-sm text-muted-foreground">All conversations from HighLevel</p>
        <SyncNowButton clientId={clientId} />
      </div>

      {syncFailed ? (
        <p className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Couldn&apos;t refresh from HighLevel just now — showing the last synced messages.
        </p>
      ) : null}

      {contacts.length === 0 ? (
        <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
          No conversations yet.
        </p>
      ) : (
        <div className="flex h-[calc(100vh-260px)] min-h-[420px] overflow-hidden rounded-lg border">
          <aside className="w-72 shrink-0 overflow-y-auto border-r">
            {contacts.map((c) => {
              const active = c.contactId === selected?.contactId;
              const preview =
                c.lastChannel === "Email"
                  ? c.lastSubject || c.lastBody
                  : c.lastBody || (c.lastChannel === "Voicemail" ? "Voicemail" : c.lastChannel === "Call" ? "Call" : "");
              return (
                <Link
                  key={c.contactId}
                  href={`?contactId=${encodeURIComponent(c.contactId)}`}
                  className={cn(
                    "flex gap-2.5 border-b px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                    active && "bg-accent"
                  )}
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {initialOf(c.contactName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{c.contactName ?? "Unknown contact"}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {new Date(c.lastTimestamp).toLocaleDateString()}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {c.lastChannel === "Email" ? (
                        <Mail className="size-3 shrink-0" />
                      ) : c.lastChannel === "Call" ? (
                        <Phone className="size-3 shrink-0" />
                      ) : c.lastChannel === "Voicemail" ? (
                        <Voicemail className="size-3 shrink-0" />
                      ) : (
                        <MessageSquare className="size-3 shrink-0" />
                      )}
                      <span className="truncate">{preview || "(no text content)"}</span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </aside>
          <div className="min-w-0 flex-1">
            {selected ? (
              <ConversationDetailThread contactName={selected.contactName} messages={selected.messages} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
