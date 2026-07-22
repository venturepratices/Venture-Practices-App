import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * Toggle a comment's resolved state. Resolving marks it done without deleting
 * (so the thread history stays intact). Gated by client access + the comment
 * capability, resolved via the comment → version → asset → client chain.
 */
const patchSchema = z.object({ resolved: z.boolean() });

export async function PATCH(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { commentId } = await params;

  const comment = await prisma.assetComment.findUnique({
    where: { id: commentId },
    select: { id: true, version: { select: { asset: { select: { clientId: true } } } } },
  });
  if (!comment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(comment.version.asset.clientId);
    await requireCapability("canCommentOnAssets");
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
