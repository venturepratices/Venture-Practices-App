import { prisma } from "@/lib/prisma";

export async function logActivity(params: {
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string;
  entityLabel: string;
  action: string;
  description: string;
}) {
  return prisma.activityLog.create({ data: params });
}
