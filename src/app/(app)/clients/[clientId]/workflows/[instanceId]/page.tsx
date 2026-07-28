import { notFound } from "next/navigation";

import { canUseCapability } from "@/lib/permissions";
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

  const instance = await prisma.workflowInstance.findFirst({
    where: { id: instanceId, clientId },
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
  });
  if (!instance) notFound();

  return (
    <WorkflowInstanceDetail
      instance={instance}
      canManage={canManage}
      backHref={`/clients/${clientId}/workflows`}
      backLabel="Workflows"
      redirectOnDelete={`/clients/${clientId}/workflows`}
    />
  );
}
