import { put } from "@vercel/blob";

import { prisma } from "@/lib/prisma";

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
        assignee: true,
        client: true,
        comments: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
        links: { orderBy: { createdAt: "asc" } },
      },
    });

    const archivedTask = await tx.archivedTask.create({
      data: {
        originalTaskId: task.id,
        title: task.title,
        assigneeId: task.assigneeId,
        assigneeName: task.assignee?.name ?? null,
        clientId: task.clientId,
        clientName: task.client?.name ?? null,
        occurrence: task.occurrence,
        status: task.status,
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

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await put(`archive/${archived.id}.json`, JSON.stringify(archived, null, 2), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
    });
  } else {
    console.warn("BLOB_READ_WRITE_TOKEN not set — archive durability mirror skipped for", archived.id);
  }

  return archived;
}
