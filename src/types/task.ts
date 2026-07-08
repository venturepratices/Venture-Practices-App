import type { Prisma } from "@/generated/prisma/client";

export type TaskWithRelations = Prisma.TaskGetPayload<{
  include: { assignee: { select: { id: true; name: true } }; client: { select: { id: true; name: true } } };
}>;
