import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  label: z.string().trim().min(1, "Name is required").max(80),
});

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const project = await prisma.privateProject.findUnique({ where: { id: projectId } });
  // Not found (not "not yours") for anyone but the owner — same
  // leak-nothing posture as a private task's own detail route.
  if (!project || project.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const project = await prisma.privateProject.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.privateProject.update({
    where: { id: projectId },
    data: { label: parsed.data.label },
    include: { _count: { select: { tasks: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const project = await prisma.privateProject.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Its tasks are not deleted — they just fall back to "no project"
  // (Task.privateProjectId ON DELETE SET NULL), same as unassigning a task
  // from a deleted status would never be allowed to silently delete the task.
  await prisma.privateProject.delete({ where: { id: projectId } });

  return NextResponse.json({ ok: true });
}
