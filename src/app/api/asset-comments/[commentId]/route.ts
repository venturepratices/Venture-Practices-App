import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveAssetActor, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * Toggle a comment's resolved state. Resolving marks it done without deleting
 * (so the thread history stays intact). Accepts either a TeamMember session
 * (canCommentOnAssets) or a ClientUser session (their own client, non-draft
 * asset) — see resolveAssetActor.
 */
const patchSchema = z.object({ resolved: z.boolean() });

export async function PATCH(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  const { commentId } = await params;

  const comment = await prisma.assetComment.findUnique({
    where: { id: commentId },
    select: { id: true, version: { select: { asset: { select: { clientId: true, status: true } } } } },
  });
  if (!comment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await resolveAssetActor(comment.version.asset, "canCommentOnAssets");
  } catch (error) {
    return toErrorResponse(error);
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
