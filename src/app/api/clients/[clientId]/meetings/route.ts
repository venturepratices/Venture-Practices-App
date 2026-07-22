import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { summarizeMeetingTranscript } from "@/lib/meeting-summary";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const createMeetingNoteSchema = z.object({
  title: z.string().trim().min(1, "Title can't be empty").max(200),
  meetingDate: z.coerce.date(),
  transcript: z.string().trim().min(1, "Transcript can't be empty").max(100000),
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

  let summary: string;
  try {
    summary = await summarizeMeetingTranscript(parsed.data.transcript);
  } catch (error) {
    console.error("Meeting transcript summarization failed:", error);
    return NextResponse.json({ error: "Failed to summarize transcript" }, { status: 502 });
  }

  const meetingNote = await prisma.meetingNote.create({
    data: {
      clientId,
      authorId: session.user.id,
      title: parsed.data.title,
      meetingDate: parsed.data.meetingDate,
      transcript: parsed.data.transcript,
      summary,
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
    action: "meeting_noted",
    description: `${session.user.name ?? "Someone"} added a meeting note to "${client?.name ?? "a client"}"`,
  });

  return NextResponse.json(meetingNote, { status: 201 });
}
