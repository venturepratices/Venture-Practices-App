import { NextResponse } from "next/server";
import { z } from "zod";

import { archiveCampaign } from "@/lib/archive";
import { auth } from "@/lib/auth";
import { createDatabaseSnapshot, writeBackupToBlob } from "@/lib/backup";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { archiveClientChannel } from "@/lib/slack";

const deleteSchema = z.object({ confirmName: z.string().min(1) });

/**
 * Permanently deletes a Client and every piece of its own data (notes,
 * assets, workflows, credentials, etc. — anything with a Cascade relation to
 * Client; see prisma/schema.prisma). Tasks and Workflow instances that
 * reference this client are NOT deleted — their client relation is nullable
 * with onDelete: SetNull, so they survive as internal/no-client records,
 * matching this app's existing "detach, don't destroy" convention for
 * Task.assignee/Task.client elsewhere.
 *
 * Campaigns and Orders are handled specially rather than left to cascade:
 * both are ON DELETE RESTRICT at the database level (see the schema
 * comments), so this route archives every active Campaign through the same
 * archiveCampaign() path the single-campaign delete route uses (real
 * archive-page visibility, one-click restorable) and refuses to proceed at
 * all while the client still has any Orders — those are permanent billing
 * documents with no delete/archive path of their own, so the only honest
 * option is to block rather than silently destroy them.
 *
 * This is the single most destructive action in the app, so it's gated
 * behind (a) the canDeleteClients capability — never auto-granted, an admin
 * must explicitly check it for someone, (b) requiring the caller to type the
 * client's exact current name as confirmation, and (c) an automatic fresh
 * full-database backup taken immediately before the delete, independent of
 * the daily backup cron, so a mistake here is always recoverable via
 * scripts/restore-from-backup.ts.
 *
 * The client's Slack channel (if one exists) is archived as the last step —
 * best-effort, after the delete has already succeeded — so deleted clients
 * don't leave a channel lingering in the workspace forever.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, slackChannelId: true } });
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireCapability("canDeleteClients");
    await requireClientAccess(clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Type the client's exact name to confirm." }, { status: 400 });
  }
  if (parsed.data.confirmName !== client.name) {
    return NextResponse.json({ error: `That doesn't match "${client.name}". Nothing was deleted.` }, { status: 400 });
  }

  const orderCount = await prisma.clientOrder.count({ where: { clientId } });
  if (orderCount > 0) {
    return NextResponse.json(
      {
        error: `"${client.name}" has ${orderCount} order document${orderCount === 1 ? "" : "s"} on file. Orders are permanent billing history and can't be deleted or archived, so this client can't be deleted while any exist.`,
      },
      { status: 409 },
    );
  }

  const campaignIds = (await prisma.campaign.findMany({ where: { clientId }, select: { id: true } })).map((c) => c.id);
  for (const campaignId of campaignIds) {
    await archiveCampaign(campaignId, session.user.id);
  }

  const snapshot = await createDatabaseSnapshot();
  const backupResult = await writeBackupToBlob(snapshot, `${new Date(snapshot.createdAt).toISOString().slice(0, 10)}-pre-delete-client-${clientId}`);
  if (!backupResult.written) {
    return NextResponse.json(
      { error: "Couldn't take a safety backup before deleting (no Blob storage configured). Refusing to delete without one." },
      { status: 500 },
    );
  }

  await prisma.$transaction([
    prisma.activityLog.create({
      data: {
        actorId: session.user.id,
        actorName: session.user.name ?? null,
        entityType: "Client",
        entityId: clientId,
        entityLabel: client.name,
        action: "deleted",
        description: `${session.user.name ?? "Someone"} permanently deleted client "${client.name}" and all of its data (notes, assets, workflows, campaigns, orders, credentials, etc.). A safety backup was taken first: ${backupResult.pathname}.`,
      },
    }),
    prisma.client.delete({ where: { id: clientId } }),
  ]);

  if (client.slackChannelId) {
    await archiveClientChannel(client.slackChannelId);
  }

  return NextResponse.json({ ok: true });
}
