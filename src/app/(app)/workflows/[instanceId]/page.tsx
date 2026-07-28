import { notFound } from "next/navigation";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { WorkflowInstanceDetail } from "@/components/workflows/workflow-instance-detail";

export default async function WorkflowInstanceDetailPage({ params }: { params: Promise<{ instanceId: string }> }) {
  if (!(await canUseCapability("canViewWorkflows"))) notFound();
  const canManage = await canUseCapability("canManageWorkflows");

  const { instanceId } = await params;
  const [instance, teamMembers] = await Promise.all([
    prisma.workflowInstance.findFirst({
      where: { id: instanceId, clientId: null },
      include: {
        client: { select: { id: true, name: true } },
        workflowTemplate: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        tasks: {
          include: {
            assignees: { include: { teamMember: { select: { id: true, name: true } } } },
            client: { select: { id: true, name: true } },
          },
          orderBy: [{ workflowStageNumber: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
    canManage ? prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  if (!instance) notFound();

  const recentActivity = await prisma.activityLog.findMany({
    where: {
      OR: [
        { entityType: "WorkflowInstance", entityId: instance.id },
        { entityType: "Task", entityId: { in: instance.tasks.map((t) => t.id) } },
      ],
    },
    select: { id: true, description: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return (
    <WorkflowInstanceDetail
      instance={instance}
      canManage={canManage}
      backHref="/workflows"
      backLabel="Workflows"
      redirectOnDelete="/workflows"
      teamMembers={teamMembers}
      recentActivity={recentActivity}
    />
  );
}
