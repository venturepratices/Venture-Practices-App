import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notify";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { extractMentionedTeamMemberIds } from "@/lib/text-format";

const createClientNoteSchema = z.object({
  // Stores Tiptap-produced HTML (bold/lists/@mentions) — 20000 covers the
  // markup overhead the same way Task.description's limit was raised.
  body: z.string().trim().min(1, "Note can't be empty").max(20000),
});

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  try {
    await requireClientAccess(clientId);
    await requireCapability("canCreateClientNotes");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createClientNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const note = await prisma.clientNote.create({
    data: { clientId, authorId: session.user.id, body: parsed.data.body },
    include: { author: { select: { id: true, name: true } } },
  });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: clientId,
    entityLabel: client?.name ?? clientId,
    clientId,
    action: "noted",
    description: `${session.user.name ?? "Someone"} added a note to "${client?.name ?? "a client"}"`,
  });

  const validTeamMemberIds = new Set(
    (await prisma.teamMember.findMany({ select: { id: true } })).map((m) => m.id)
  );
  const mentionedIds = extractMentionedTeamMemberIds(parsed.data.body).filter(
    (id) => id !== session.user.id && validTeamMemberIds.has(id)
  );
  for (const id of mentionedIds) {
    await notify({
      recipientId: id,
      type: "MENTIONED",
      entityType: "Client",
      entityId: clientId,
      entityLabel: client?.name ?? clientId,
      title: `You were mentioned in a note on "${client?.name ?? "a client"}"`,
      lines: [`By ${session.user.name ?? "someone"}`],
      linkPath: `/clients/${clientId}/notes`,
    });
  }

  return NextResponse.json(note, { status: 201 });
}
