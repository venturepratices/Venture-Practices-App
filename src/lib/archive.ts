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
      include: { assignee: true, client: true },
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
        deletedById,
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
