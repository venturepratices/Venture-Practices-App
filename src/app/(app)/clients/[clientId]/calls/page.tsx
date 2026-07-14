import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { syncClientConversations } from "@/lib/highlevel";
import { CallLogRow, type CallRow } from "@/components/clients/call-log-row";
import { SyncNowButton } from "@/components/clients/sync-now-button";

export default async function CallsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;

  const connection = await prisma.clientHighLevelConnection.findUnique({ where: { clientId } });
  if (!connection) {
    return (
      <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
        HighLevel isn&apos;t connected for this client yet.{" "}
        <Link href={`/clients/${clientId}`} className="text-primary underline-offset-4 hover:underline">
          Connect it on the Info tab
        </Link>{" "}
        to see call tracking here.
      </div>
    );
  }

  let syncFailed = false;
  try {
    await syncClientConversations(clientId);
  } catch {
    syncFailed = true;
  }

  const calls = await prisma.conversationMessage.findMany({
    where: { clientId, channel: "Call" },
    orderBy: { ghlTimestamp: "desc" },
  });

  const rows: CallRow[] = calls.map((c) => ({
    id: c.id,
    contactName: c.contactName,
    direction: c.direction,
    subject: c.subject,
    body: c.body,
    ghlTimestamp: c.ghlTimestamp.toISOString(),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Call tracking from HighLevel</p>
        <SyncNowButton clientId={clientId} />
      </div>

      {syncFailed ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Couldn&apos;t refresh from HighLevel just now — showing the last synced calls.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">No calls yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((call) => (
            <CallLogRow key={call.id} call={call} />
          ))}
        </ul>
      )}
    </div>
  );
}
