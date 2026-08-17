import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai-assistant/conversations — every "Ask Viktor" conversation the
 * caller owns, newest first. Scoped by session.user.id — a user only sees
 * their own history, never anyone else's. Admin-only for v1 (same gate as
 * the send-message route); when per-user access opens up, swap the
 * requireAdmin() for a capability check.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  const conversations = await prisma.aiConversation.findMany({
    where: { teamMemberId: session.user.id },
    select: { id: true, title: true, updatedAt: true, createdAt: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ conversations });
}

/**
 * POST /api/ai-assistant/conversations — create a fresh empty conversation
 * owned by the caller. Returns its id so the panel can immediately POST a
 * first message. Deliberately doesn't require a body: an empty chat that
 * gets abandoned is fine — it just never gets a title and never bothers
 * anyone. If empty-chat cleanup ever matters, a periodic prune of rows
 * with no AiMessage children is trivial to add.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  const conversation = await prisma.aiConversation.create({
    data: { teamMemberId: session.user.id },
    select: { id: true, title: true, updatedAt: true, createdAt: true },
  });

  return NextResponse.json({ conversation }, { status: 201 });
}
