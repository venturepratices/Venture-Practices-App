import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sanitizeRichText } from "@/lib/rich-text-sanitize";
import { extractMentionedTeamMemberIds } from "@/lib/text-format";
import { notify } from "@/lib/notify";

const createMeetingNoteSchema = z.object({
  title: z.string().trim().min(1, "Title can't be empty").max(200),
  meetingDate: z.coerce.date(),
  // Stores Tiptap-produced HTML (bold/lists/@mentions) — 100000 already has
  // ample headroom for the markup overhead. Cleaned to the editor's
  // allow-list before anything stores or reads it.
  transcript: z
    .string()
    .trim()
    .min(1, "Transcript can't be empty")
    .max(100000)
    .transform(sanitizeRichText)
    .refine((html) => html.trim().length > 0, "Transcript can't be empty"),
});

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  try {
    await requireClientAccess(clientId);
    await requireCapability("canCreateMeetingNotes");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createMeetingNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const meetingNote = await prisma.meetingNote.create({
    data: {
      clientId,
      authorId: session.user.id,
      title: parsed.data.title,
      meetingDate: parsed.data.meetingDate,
      transcript: parsed.data.transcript,
    },
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
    action: "meeting_noted",
    description: `${session.user.name ?? "Someone"} added a meeting note to "${client?.name ?? "a client"}"`,
  });

  const validTeamMemberIds = new Set(
    (await prisma.teamMember.findMany({ select: { id: true } })).map((m) => m.id)
  );
  const mentionedIds = extractMentionedTeamMemberIds(parsed.data.transcript).filter(
    (id) => id !== session.user.id && validTeamMemberIds.has(id)
  );
  for (const id of mentionedIds) {
    await notify({
      recipientId: id,
      type: "MENTIONED",
      entityType: "Client",
      entityId: clientId,
      entityLabel: client?.name ?? clientId,
      title: `You were mentioned in a meeting note on "${client?.name ?? "a client"}"`,
      lines: [`By ${session.user.name ?? "someone"}`, `"${parsed.data.title}"`],
      linkPath: `/clients/${clientId}/meetings`,
    });
  }

  return NextResponse.json(meetingNote, { status: 201 });
}
