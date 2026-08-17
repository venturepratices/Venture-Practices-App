import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai-assistant/conversations/[id] — one conversation and every
 * message in it, newest last (chronological read order). 404s (not 403 —
 * leak nothing) if the caller doesn't own it, same convention every other
 * scoped route in this app uses.
 */
export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { conversationId } = await params;
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: conversationId, teamMemberId: session.user.id },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      viktorThreadId: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, body: true, attachmentsJson: true, createdAt: true },
      },
    },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ conversation });
}

/**
 * DELETE /api/ai-assistant/conversations/[id] — the "clear this chat"
 * button. Cascade wipes every AiMessage inside. Ownership-checked the
 * same 404-not-403 way as the GET above.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { conversationId } = await params;
  const { count } = await prisma.aiConversation.deleteMany({
    where: { id: conversationId, teamMemberId: session.user.id },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
