import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const updateClientNoteSchema = z.object({
  body: z.string().trim().min(1, "Note can't be empty").max(4000),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ clientId: string; noteId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId, noteId } = await params;
  try {
    await requireClientAccess(clientId);
    await requireCapability("canEditClientNotes");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = updateClientNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  // Ownership: the note must actually belong to the client in the URL.
  const target = await prisma.clientNote.findUnique({ where: { id: noteId }, select: { clientId: true } });
  if (!target || target.clientId !== clientId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const note = await prisma.clientNote.update({
    where: { id: noteId },
    data: { body: parsed.data.body },
    include: { author: { select: { id: true, name: true } } },
  });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: clientId,
    entityLabel: client?.name ?? clientId,
    action: "note_edited",
    description: `${session.user.name ?? "Someone"} edited a note on "${client?.name ?? "a client"}"`,
  });

  return NextResponse.json(note);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ clientId: string; noteId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId, noteId } = await params;
  try {
    await requireClientAccess(clientId);
    await requireCapability("canDeleteClientNotes");
  } catch (error) {
    return toErrorResponse(error);
  }

  const target = await prisma.clientNote.findUnique({ where: { id: noteId }, select: { clientId: true } });
  if (!target || target.clientId !== clientId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.clientNote.delete({ where: { id: noteId } });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: clientId,
    entityLabel: client?.name ?? clientId,
    action: "note_deleted",
    description: `${session.user.name ?? "Someone"} deleted a note from "${client?.name ?? "a client"}"`,
  });

  return NextResponse.json({ ok: true });
}
