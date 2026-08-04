import { put } from "@vercel/blob";

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
