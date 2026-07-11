import type { Prisma } from "@/generated/prisma/client";

export type TaskWithRelations = Prisma.TaskGetPayload<{
  include: { assignee: { select: { id: true; name: true } }; client: { select: { id: true; name: true } } };
}>;

// Richer shape used only by the task detail panel, which is the one place
// that needs comments and links alongside the base relations.
export type TaskDetail = Prisma.TaskGetPayload<{
  include: {
    assignee: { select: { id: true; name: true } };
    client: { select: { id: true; name: true } };
    comments: { include: { author: { select: { id: true; name: true } } } };
    links: true;
  };
}>;
