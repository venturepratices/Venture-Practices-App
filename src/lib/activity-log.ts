import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function logActivity(params: {
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string;
  entityLabel: string;
  clientId?: string | null;
  action: string;
  description: string;
  details?: Prisma.InputJsonValue;
}) {
  return prisma.activityLog.create({ data: { ...params, clientId: params.clientId ?? null } });
}
