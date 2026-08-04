import { notFound } from "next/navigation";

import { canUseCapability, loadPermissions, taskVisibilityFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getTaskStatusOptions } from "@/lib/task-status";
import { WorkflowInstanceDetail } from "@/components/workflows/workflow-instance-detail";

export default async function WorkflowInstanceDetailPage({ params }: { params: Promise<{ instanceId: string }> }) {
  if (!(await canUseCapability("canViewWorkflows"))) notFound();
  const canManage = await canUseCapability("canManageWorkflows");
  const perms = await loadPermissions();

  const { instanceId } = await params;
  const [instance, teamMembers, statusOptions] = await Promise.all([
    prisma.workflowInstance.findFirst({
      where: { id: instanceId, clientId: null },
      include: {
        client: { select: { id: true, name: true } },
        workflowTemplate: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        tasks: {
          where: taskVisibilityFilter(perms?.userId ?? null),
          include: {
            assignees: { include: { teamMember: { select: { id: true, name: true } } } },
            client: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
            workflowInstance: { select: { id: true, name: true } },
            statusOption: { select: { id: true, label: true, tone: true, isComplete: true } },
          },
          orderBy: [{ workflowStageNumber: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
    canManage ? prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    getTaskStatusOptions(),
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
      backLabel="Projects"
      redirectOnDelete="/workflows"
      teamMembers={teamMembers}
      recentActivity={recentActivity}
      statusOptions={statusOptions}
    />
  );
}
