import { notFound } from "next/navigation";

import { canUseCapability, loadPermissions, taskVisibilityFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { WorkflowInstanceDetail } from "@/components/workflows/workflow-instance-detail";

export default async function ClientWorkflowInstanceDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; instanceId: string }>;
}) {
  const { clientId, instanceId } = await params;
  // Client-access is enforced by the layout; this adds the Workflows capability.
  if (!(await canUseCapability("canViewWorkflows"))) notFound();
  const canManage = await canUseCapability("canManageWorkflows");
  const perms = await loadPermissions();

  const [instance, teamMembers, folders] = await Promise.all([
    prisma.workflowInstance.findFirst({
      where: { id: instanceId, clientId },
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
          },
          orderBy: [{ workflowStageNumber: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
    canManage ? prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canManage ? prisma.workflowFolder.findMany({ where: { clientId }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
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
      backHref={`/clients/${clientId}/workflows`}
      backLabel="Projects"
      redirectOnDelete={`/clients/${clientId}/workflows`}
      teamMembers={teamMembers}
      folders={folders}
      recentActivity={recentActivity}
    />
  );
}
