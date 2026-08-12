import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { restoreArchivedClientNote } from "@/lib/archive";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ archivedNoteId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await requireCapability("canRestoreArchive");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { archivedNoteId } = await params;

  const archived = await prisma.archivedClientNote.findUnique({ where: { id: archivedNoteId } });
  if (!archived) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let note;
  try {
    note = await restoreArchivedClientNote(archivedNoteId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Restore failed." }, { status: 400 });
  }

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: note.clientId,
    entityLabel: archived.clientName ?? "a client",
    clientId: note.clientId,
    action: "note_restored",
    description: `${session.user.name ?? "Someone"} restored a note from the archive`,
  });

  return NextResponse.json(note, { status: 201 });
}
