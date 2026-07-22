import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveShareLinkAccess } from "@/lib/share-link";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({ resolved: z.boolean() });

/** Guest equivalent of PATCH /api/asset-comments/[commentId] — resolve toggle. */
export async function PATCH(request: Request, { params }: { params: Promise<{ token: string; commentId: string }> }) {
  const { token, commentId } = await params;

  const resolved = await resolveShareLinkAccess(token);
  if (!resolved.ok) {
    return NextResponse.json({ error: "This review link is no longer valid." }, { status: 404 });
  }
  const { access } = resolved;
  if (!access.passwordOk) {
    return NextResponse.json({ error: "This link is password protected." }, { status: 403 });
  }
  if (!access.cookiePayload?.guestReviewerId) {
    return NextResponse.json({ error: "Please enter your name and email first." }, { status: 403 });
  }

  const comment = await prisma.assetComment.findUnique({
    where: { id: commentId },
    select: { id: true, version: { select: { assetId: true } } },
  });
  if (!comment || comment.version.assetId !== access.link.assetId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.assetComment.update({
    where: { id: commentId },
    data: { resolvedAt: parsed.data.resolved ? new Date() : null },
  });

  return NextResponse.json(updated);
}
