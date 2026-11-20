import Link from "next/link";
import { notFound } from "next/navigation";
import { PlugZap } from "lucide-react";

import { canUseCapability, requireUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { syncClientConversations } from "@/lib/highlevel";
import { loadCallsPageData } from "@/lib/calls/data";
import { parseCallsQuery, rangeWindow } from "@/lib/calls/query";
import { CallsView } from "@/components/calls/calls-view";
import { CallLogRow, type CallRow } from "@/components/clients/call-log-row";
import { SyncNowButton } from "@/components/clients/sync-now-button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * One client's Calls tab. It shows the same numbers as the main Calls page
 * (calls, answered vs missed, tracking numbers, first-time vs repeat), locked
 * to this client. The numbers come from the call details table, which is
 * filled even where HighLevel blocks message history on a client's account.
 * Voicemail and call notes from the message cache, when there are any, sit
 * underneath.
 */
export default async function CallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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

  // The client in the URL always wins over any `client=` the address carries,
  // so this tab can only ever show this client. The data layer also checks the
  // signed-in person is allowed to see the client.
  const actor = await requireUser();
  const query = { ...parseCallsQuery(await searchParams), clientId };
  const now = new Date();
  const { start, end } = rangeWindow(query.range, now);
  const data = await loadCallsPageData({ actor, query, start, end });

  const notes = await prisma.conversationMessage.findMany({
    where: { clientId, channel: { in: ["Call", "Voicemail"] } },
    orderBy: { ghlTimestamp: "desc" },
    take: 50,
  });
  const noteRows: CallRow[] = notes.map((c) => ({
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Call tracking from HighLevel</p>
        <SyncNowButton clientId={clientId} />
      </div>

      {syncFailed ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Couldn&apos;t refresh from HighLevel just now — showing the last synced calls.
        </p>
      ) : null}

      <CallsView data={data} query={query} now={now.toISOString()} lockedClient />

      {noteRows.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Voicemails and call notes</h2>
          <ul className="divide-y rounded-lg border">
            {noteRows.map((call, i) => (
              <CallLogRow key={call.id} call={call} delayMs={Math.min(i * 40, 400)} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
