import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { syncClientConversations } from "@/lib/highlevel";
import { ConversationThread, type ThreadMessage } from "@/components/clients/conversation-thread";
import { SyncNowButton } from "@/components/clients/sync-now-button";

export default async function ConversationsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;

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

  const messages = await prisma.conversationMessage.findMany({
    where: { clientId, channel: { in: ["SMS", "Email"] } },
    orderBy: { ghlTimestamp: "desc" },
  });

  // Group into per-contact threads, newest-active contact first; messages within
  // a thread read chronologically (oldest → newest).
  const byContact = new Map<string, { contactName: string | null; messages: ThreadMessage[] }>();
  for (const m of messages) {
    const key = m.ghlContactId || m.id;
    if (!byContact.has(key)) byContact.set(key, { contactName: m.contactName, messages: [] });
    byContact.get(key)!.messages.push({
      id: m.id,
      channel: m.channel,
      direction: m.direction,
      subject: m.subject,
      body: m.body,
      ghlTimestamp: m.ghlTimestamp.toISOString(),
    });
  }
  const threads = [...byContact.values()].map((t) => ({
    ...t,
    messages: [...t.messages].reverse(),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Email &amp; SMS from HighLevel</p>
        <SyncNowButton clientId={clientId} />
      </div>

      {syncFailed ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Couldn&apos;t refresh from HighLevel just now — showing the last synced messages.
        </p>
      ) : null}

      {threads.length === 0 ? (
        <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
          No conversations yet.
        </p>
      ) : (
        <div className="space-y-4">
          {threads.map((t, i) => (
            <ConversationThread key={i} contactName={t.contactName} messages={t.messages} />
          ))}
        </div>
      )}
    </div>
  );
}
