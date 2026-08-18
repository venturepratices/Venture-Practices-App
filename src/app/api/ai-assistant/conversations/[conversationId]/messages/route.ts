import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { askViktor } from "@/lib/viktor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  attachments: z
    .array(z.object({ name: z.string().max(200), sizeBytes: z.number().int().nonnegative() }))
    .max(10)
    .optional(),
});

/**
 * POST /api/ai-assistant/conversations/[id]/messages — the "send" button.
 * Persists the user's message, forwards to Viktor, persists Viktor's reply,
 * and returns both so the panel can render optimistically without a
 * separate refetch.
 *
 * Titles the conversation on the first send (truncated user message) —
 * only if title is still null, so a rename step could safely land later
 * without this route stomping it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
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
  const raw = await request.json().catch(() => null);
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
  }

  // Ownership + fetch the current thread id (if Viktor has assigned one).
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: conversationId, teamMemberId: session.user.id },
    select: { id: true, title: true, viktorThreadId: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Persist the user's message first, so a Viktor failure still leaves the
  // question in their history — the panel then renders the assistant error
  // as a normal reply instead of silently dropping the question.
  const userMessage = await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      body: parsed.data.body,
      attachmentsJson: parsed.data.attachments ?? undefined,
    },
    select: { id: true, role: true, body: true, attachmentsJson: true, createdAt: true },
  });

  const result = await askViktor({
    question: parsed.data.body,
    attachments: parsed.data.attachments,
    threadId: conversation.viktorThreadId ?? undefined,
  });

  const assistantBody = result.ok ? result.answer : result.reason;
  const assistantMessage = await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      body: assistantBody,
    },
    select: { id: true, role: true, body: true, attachmentsJson: true, createdAt: true },
  });

  // Cache Viktor's thread id on the conversation the first time we get one,
  // and title the conversation from the first user message. Bumping
  // updatedAt happens naturally via @updatedAt on any write to this row.
  await prisma.aiConversation.update({
    where: { id: conversation.id },
    data: {
      viktorThreadId: result.ok && result.threadId ? result.threadId : conversation.viktorThreadId,
      title: conversation.title ?? parsed.data.body.slice(0, 60),
    },
  });

  return NextResponse.json({
    userMessage,
    assistantMessage,
    viktorOk: result.ok,
  });
}
