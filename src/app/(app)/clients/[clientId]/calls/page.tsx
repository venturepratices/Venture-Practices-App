import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone, PlugZap } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { syncClientConversations } from "@/lib/highlevel";
import { CallLogRow, type CallRow } from "@/components/clients/call-log-row";
import { SyncNowButton } from "@/components/clients/sync-now-button";
import { EmptyState } from "@/components/ui/empty-state";

export default async function CallsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;

  if (!(await canUseCapability("canViewConversations"))) notFound();

  const connection = await prisma.clientHighLevelConnection.findUnique({ where: { clientId } });
  if (!connection) {
    return (
      <div className="rounded-lg border">
        <EmptyState
          icon={PlugZap}
          title="HighLevel isn't connected for this client yet."
          description="Connect it on the Info tab to see call tracking here."
          action={
            <Link href={`/clients/${clientId}`} className="text-sm text-primary underline-offset-4 hover:underline">
              Connect it on the Info tab
            </Link>
          }
        />
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
    where: { clientId, channel: { in: ["Call", "Voicemail"] } },
    orderBy: { ghlTimestamp: "desc" },
  });

  const rows: CallRow[] = calls.map((c) => ({
    id: c.id,
    contactName: c.contactName,
    channel: c.channel,
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
        <div className="rounded-lg border">
          <EmptyState icon={Phone} title="No calls yet." />
        </div>
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
