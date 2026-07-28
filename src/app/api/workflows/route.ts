import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { accessibleClientFilter, requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createWorkflowInstanceSchema } from "@/lib/validations/workflow-instance";
import { notifyWorkflowStageTasks } from "@/lib/workflow-advance";
import { spawnWorkflowTasks, type StagesSnapshot } from "@/lib/workflow-instance";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canViewWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const clientIdParam = new URL(request.url).searchParams.get("clientId");
  const clientFilter = await accessibleClientFilter("clientId");
  // Internal workflows (clientId: null) are visible to anyone with
  // canViewWorkflows regardless of per-client access — there's no client to
  // scope them to. Admins/allClientsAccess already get {} (no filter).
  const scopedWhere = Object.keys(clientFilter).length === 0 ? {} : { OR: [{ clientId: null }, clientFilter] };

  const instances = await prisma.workflowInstance.findMany({
    where: { ...scopedWhere, ...(clientIdParam ? { clientId: clientIdParam } : {}) },
    include: {
      client: { select: { id: true, name: true } },
      workflowTemplate: { select: { id: true, name: true } },
      tasks: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(instances);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canManageWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createWorkflowInstanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  if (parsed.data.clientId) {
    try {
      await requireClientAccess(parsed.data.clientId);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  const clientId = parsed.data.clientId ?? null;

  // Blank start — no template, no stages/tasks yet. The user builds up the
  // pipeline afterward via the "Add stage" affordance + per-stage ad-hoc
  // task adds, both on the instance detail page.
  if (!parsed.data.workflowTemplateId) {
    const instance = await prisma.workflowInstance.create({
      data: {
        name: parsed.data.name,
        workflowTemplateId: null,
        clientId,
        stagesSnapshot: [],
        currentStageNumber: 1,
        createdById: session.user.id,
      },
    });

    const client = clientId ? await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }) : null;
    const instanceLabel = client ? `${instance.name} — ${client.name}` : instance.name;
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "WorkflowInstance",
      entityId: instance.id,
      entityLabel: instanceLabel,
      action: "workflow_started",
      description: `${session.user.name ?? "Someone"} started "${instanceLabel}" from scratch (no template)`,
    });

    return NextResponse.json(instance, { status: 201 });
  }

  const template = await prisma.workflowTemplate.findUnique({
    where: { id: parsed.data.workflowTemplateId },
    include: {
      stageTemplates: {
        orderBy: { sequenceNumber: "asc" },
        include: {
          taskTemplates: {
            orderBy: { sequenceNumber: "asc" },
            include: { defaultAssignees: true, links: { orderBy: { createdAt: "asc" } } },
          },
        },
      },
    },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 400 });
  }
  if (template.stageTemplates.length === 0) {
    return NextResponse.json({ error: "That template has no stages yet — add at least one before starting a workflow." }, { status: 400 });
  }

  const stagesSnapshot: StagesSnapshot = template.stageTemplates.map((stage) => ({
    name: stage.name,
    description: stage.description,
    sequenceNumber: stage.sequenceNumber,
    taskTemplates: stage.taskTemplates.map((task) => ({
      title: task.title,
      description: task.description,
      defaultStatus: task.defaultStatus,
      sequenceNumber: task.sequenceNumber,
      defaultAssigneeIds: task.defaultAssignees.map((a) => a.teamMemberId),
      links: task.links.map((link) => ({ url: link.url, label: link.label })),
    })),
  }));

  const { instance, taskCount } = await prisma.$transaction(async (tx) => {
    const created = await tx.workflowInstance.create({
      data: {
        name: parsed.data.name,
        workflowTemplateId: template.id,
        clientId,
        stagesSnapshot,
        createdById: session.user.id,
      },
    });

    await spawnWorkflowTasks(tx, { instanceId: created.id, clientId, stages: stagesSnapshot });
    const count = await tx.task.count({ where: { workflowInstanceId: created.id } });

    return { instance: created, taskCount: count };
  });

  // Stage 1 has no predecessor stage completing to trigger a notification —
  // ping its assignees directly, right after the tasks exist.
  await notifyWorkflowStageTasks(instance.id, 1, session.user.id);

  const client = clientId ? await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }) : null;
  const instanceLabel = client ? `${instance.name} — ${client.name}` : instance.name;
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "WorkflowInstance",
    entityId: instance.id,
    entityLabel: instanceLabel,
    action: "workflow_started",
    description: `${session.user.name ?? "Someone"} started "${instanceLabel}" from template "${template.name}" — ${stagesSnapshot.length} stages, ${taskCount} tasks`,
  });

  return NextResponse.json(instance, { status: 201 });
}
