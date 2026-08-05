import { put } from "@vercel/blob";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ArchivedCommentSnapshot, ArchivedLinkSnapshot } from "@/types/task";

type ArchivedAssigneeSnapshot = { id: string; name: string };

/**
 * Deletes a live Task and writes a full denormalized snapshot to ArchivedTask
 * in the same transaction, so a task is never just hard-deleted. Immediately
 * after, the same snapshot is mirrored to Vercel Blob as a standalone JSON
 * object — a second, independent failure domain from Postgres, so the archive
 * is still recoverable (downloadable from the Vercel dashboard, plain JSON,
 * no CLI or technical step needed) even if the main database is broken.
 */
export async function archiveTask(taskId: string, deletedById: string | null) {
  const archived = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        assignees: { include: { teamMember: { select: { id: true, name: true } } } },
        client: true,
        comments: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
        links: { orderBy: { createdAt: "asc" } },
        statusOption: { select: { label: true } },
      },
    });

    const assigneeSnapshots: ArchivedAssigneeSnapshot[] = task.assignees.map((a) => ({
      id: a.teamMemberId,
      name: a.teamMember.name,
    }));

    const archivedTask = await tx.archivedTask.create({
      data: {
        originalTaskId: task.id,
        title: task.title,
        description: task.description,
        assigneeId: assigneeSnapshots[0]?.id ?? null,
        assigneeName: assigneeSnapshots[0]?.name ?? null,
        assignees: assigneeSnapshots,
        clientId: task.clientId,
        clientName: task.client?.name ?? null,
        occurrence: task.occurrence,
        status: task.status,
        statusLabel: task.statusOption.label,
        deadline: task.deadline,
        taskCreatedAt: task.createdAt,
        taskUpdatedAt: task.updatedAt,
        ...(deletedById ? { deletedBy: { connect: { id: deletedById } } } : {}),
        comments: task.comments.map((comment) => ({
          authorName: comment.author?.name ?? "Former team member",
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
        })),
        links: task.links.map((link) => ({
          label: link.label,
          url: link.url,
          createdAt: link.createdAt.toISOString(),
        })),
      },
    });

    await tx.task.delete({ where: { id: taskId } });

    return archivedTask;
  });

  // Blob credentials are either a classic BLOB_READ_WRITE_TOKEN or, for stores
  // connected via Vercel's OIDC integration, a BLOB_STORE_ID (the SDK resolves
  // the short-lived OIDC token itself from the Vercel runtime at call time).
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    await put(`archive/${archived.id}.json`, JSON.stringify(archived, null, 2), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
    });
  } else {
    console.warn("No Blob credentials configured — archive durability mirror skipped for", archived.id);
  }

  return archived;
}

/**
 * Reverses archiveTask: recreates a live Task from an ArchivedTask snapshot,
 * along with its comments/links, then removes the archive record so the task
 * isn't shown as both active and archived. Comments are restored with
 * authorId left null (only the plain authorName string survived the original
 * archive, not a linkable id) — the task detail panel already renders that
 * as "Former team member", the same fallback used when a real author account
 * is later deleted, so this isn't a new UI case.
 *
 * Any original assignee or the client that no longer exists is dropped
 * (assignees individually, client falls back to internal) rather than
 * reusing a dangling id.
 */
export async function restoreArchivedTask(archivedTaskId: string) {
  return prisma.$transaction(async (tx) => {
    const archived = await tx.archivedTask.findUniqueOrThrow({ where: { id: archivedTaskId } });

    const snapshotAssignees =
      (archived.assignees as ArchivedAssigneeSnapshot[] | null) ??
      (archived.assigneeId ? [{ id: archived.assigneeId, name: archived.assigneeName ?? "" }] : []);

    const [existingAssignees, client] = await Promise.all([
      snapshotAssignees.length > 0
        ? tx.teamMember.findMany({ where: { id: { in: snapshotAssignees.map((a) => a.id) } }, select: { id: true } })
        : [],
      archived.clientId ? tx.client.findUnique({ where: { id: archived.clientId }, select: { id: true } }) : null,
    ]);
    const existingIds = new Set(existingAssignees.map((a) => a.id));

    // Resolve a live statusId for the restored task: prefer matching the
    // frozen label text (robust even if the original status option was
    // later renamed to something else with a different id), fall back to
    // the enum key string (valid unless that exact option was deleted), and
    // fall back again to whatever status sorts first if neither matches —
    // better than a hard crash on a rare, already-unusual restore path.
    const labelMatch = archived.statusLabel
      ? await tx.taskStatusOption.findFirst({ where: { label: archived.statusLabel }, select: { id: true } })
      : null;
    const keyMatch = labelMatch ? null : await tx.taskStatusOption.findUnique({ where: { id: archived.status }, select: { id: true } });
    const fallback = labelMatch ?? keyMatch ? null : await tx.taskStatusOption.findFirst({ orderBy: { sequenceNumber: "asc" }, select: { id: true } });
    const resolvedStatusId = labelMatch?.id ?? keyMatch?.id ?? fallback?.id ?? archived.status;

    const task = await tx.task.create({
      data: {
        title: archived.title,
        description: archived.description,
        clientId: client ? archived.clientId : null,
        occurrence: archived.occurrence,
        status: archived.status,
        statusId: resolvedStatusId,
        deadline: archived.deadline,
        assignees: { create: snapshotAssignees.filter((a) => existingIds.has(a.id)).map((a) => ({ teamMemberId: a.id })) },
      },
    });

    const comments = (archived.comments as ArchivedCommentSnapshot[] | null) ?? [];
    const links = (archived.links as ArchivedLinkSnapshot[] | null) ?? [];

    if (comments.length > 0) {
      await tx.comment.createMany({
        data: comments.map((comment) => ({
          taskId: task.id,
          authorId: null,
          body: comment.body,
          createdAt: new Date(comment.createdAt),
        })),
      });
    }

    if (links.length > 0) {
      await tx.taskLink.createMany({
        data: links.map((link) => ({
          taskId: task.id,
          label: link.label,
          url: link.url,
          createdAt: new Date(link.createdAt),
        })),
      });
    }

    await tx.archivedTask.delete({ where: { id: archivedTaskId } });

    return task;
  });
}

/**
 * Deletes a live Campaign and writes a full denormalized snapshot to
 * ArchivedCampaign in the same transaction — mirrors archiveTask's
 * philosophy exactly. Campaign's tasks are NOT archived here (they already
 * survive detached, unattached but live — that's the existing, documented
 * behavior for Campaign delete); this only makes the Campaign row itself
 * recoverable instead of a permanent hard delete.
 */
export async function archiveCampaign(campaignId: string, deletedById: string | null) {
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: { client: { select: { name: true } } },
    });

    await tx.task.updateMany({ where: { campaignId }, data: { campaignId: null, campaignStage: null } });

    const archived = await tx.archivedCampaign.create({
      data: {
        originalCampaignId: campaign.id,
        clientId: campaign.clientId,
        clientName: campaign.client.name,
        name: campaign.name,
        sequenceNumber: campaign.sequenceNumber,
        mailDate: campaign.mailDate,
        creativeDueDate: campaign.creativeDueDate,
        approvalDueDate: campaign.approvalDueDate,
        printDueDate: campaign.printDueDate,
        currentStage: campaign.currentStage,
        quantity: campaign.quantity,
        geography: campaign.geography,
        budgetCents: campaign.budgetCents,
        offer: campaign.offer,
        cta: campaign.cta,
        stagesSnapshot: campaign.stagesSnapshot ?? undefined,
        campaignCreatedAt: campaign.createdAt,
        campaignUpdatedAt: campaign.updatedAt,
        ...(deletedById ? { deletedBy: { connect: { id: deletedById } } } : {}),
      },
    });

    await tx.campaign.delete({ where: { id: campaignId } });

    return archived;
  });
}

/**
 * Reverses archiveCampaign: recreates a live Campaign from an
 * ArchivedCampaign snapshot, then removes the archive record. If the
 * original client no longer exists, restoring is refused (a campaign with no
 * client isn't a meaningful record — unlike Task, which can be internal by
 * design). sequenceNumber is recomputed rather than reused, since another
 * campaign may have since taken that slot for this client.
 */
export async function restoreArchivedCampaign(archivedCampaignId: string) {
  return prisma.$transaction(async (tx) => {
    const archived = await tx.archivedCampaign.findUniqueOrThrow({ where: { id: archivedCampaignId } });

    if (!archived.clientId) {
      throw new Error("This campaign's client no longer exists — it can't be restored.");
    }
    const client = await tx.client.findUnique({ where: { id: archived.clientId }, select: { id: true } });
    if (!client) {
      throw new Error("This campaign's client no longer exists — it can't be restored.");
    }

    const lastSequence = await tx.campaign.findFirst({
      where: { clientId: archived.clientId },
      orderBy: { sequenceNumber: "desc" },
      select: { sequenceNumber: true },
    });

    const campaign = await tx.campaign.create({
      data: {
        clientId: archived.clientId,
        sequenceNumber: (lastSequence?.sequenceNumber ?? 0) + 1,
        name: archived.name,
        mailDate: archived.mailDate,
        creativeDueDate: archived.creativeDueDate,
        approvalDueDate: archived.approvalDueDate,
        printDueDate: archived.printDueDate,
        currentStage: archived.currentStage,
        quantity: archived.quantity,
        geography: archived.geography,
        budgetCents: archived.budgetCents,
        offer: archived.offer,
        cta: archived.cta,
        stagesSnapshot: archived.stagesSnapshot ?? undefined,
      },
    });

    await tx.archivedCampaign.delete({ where: { id: archivedCampaignId } });

    return campaign;
  });
}

/**
 * Deletes a live WorkflowInstance and writes a full denormalized snapshot to
 * ArchivedWorkflowInstance, on top of the existing task-archiving behavior
 * (unchanged — every task in the instance is still archived individually via
 * archiveTask). Closes the gap where the instance row itself was previously
 * a plain hard delete with no recovery path.
 */
export async function archiveWorkflowInstance(instanceId: string, deletedById: string | null) {
  const instance = await prisma.workflowInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: { client: { select: { name: true } }, tasks: { select: { id: true, title: true, clientId: true } } },
  });

  for (const task of instance.tasks) {
    await archiveTask(task.id, deletedById);
  }

  return prisma.$transaction(async (tx) => {
    const archived = await tx.archivedWorkflowInstance.create({
      data: {
        originalInstanceId: instance.id,
        name: instance.name,
        clientId: instance.clientId,
        clientName: instance.client?.name ?? null,
        status: instance.status,
        stagesSnapshot: instance.stagesSnapshot as Prisma.InputJsonValue,
        currentStageNumber: instance.currentStageNumber,
        archivedTaskCount: instance.tasks.length,
        instanceCreatedAt: instance.createdAt,
        instanceUpdatedAt: instance.updatedAt,
        instanceCompletedAt: instance.completedAt,
        ...(deletedById ? { deletedBy: { connect: { id: deletedById } } } : {}),
      },
    });

    await tx.workflowInstance.delete({ where: { id: instanceId } });

    return archived;
  });
}

/**
 * Reverses archiveWorkflowInstance: recreates a live WorkflowInstance from an
 * ArchivedWorkflowInstance snapshot, then removes the archive record. This
 * only restores the instance's own metadata (name/status/stage progress) —
 * its tasks were archived separately as ArchivedTask rows and are restored
 * independently from the Tasks archive tab, same as any other archived task.
 * If the original client no longer exists, the instance is restored as
 * internal (clientId null) rather than refused, matching Task's own fallback.
 */
export async function restoreArchivedWorkflowInstance(archivedInstanceId: string) {
  return prisma.$transaction(async (tx) => {
    const archived = await tx.archivedWorkflowInstance.findUniqueOrThrow({ where: { id: archivedInstanceId } });

    const client = archived.clientId ? await tx.client.findUnique({ where: { id: archived.clientId }, select: { id: true } }) : null;

    const instance = await tx.workflowInstance.create({
      data: {
        name: archived.name,
        clientId: client ? archived.clientId : null,
        status: archived.status,
        stagesSnapshot: archived.stagesSnapshot as Prisma.InputJsonValue,
        currentStageNumber: archived.currentStageNumber,
        completedAt: archived.instanceCompletedAt,
      },
    });

    await tx.archivedWorkflowInstance.delete({ where: { id: archivedInstanceId } });

    return instance;
  });
}
