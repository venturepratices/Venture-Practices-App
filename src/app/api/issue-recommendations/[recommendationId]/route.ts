import { NextResponse } from "next/server";

import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateRecommendationSchema } from "@/lib/validations/leadership";

// Marks (or unmarks) a recommendation as the issue's decision. One decision
// per issue: marking this one clears any other on the same issue.
export async function PATCH(request: Request, { params }: { params: Promise<{ recommendationId: string }> }) {
  try {
    await requireCapability("canUseLeadership");
  } catch (error) {
    return toErrorResponse(error);
  }
  const { recommendationId } = await params;
  const recommendation = await prisma.issueRecommendation.findUnique({
    where: { id: recommendationId },
    include: { issue: { select: { archivedAt: true } } },
  });
  if (!recommendation || recommendation.issue.archivedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateRecommendationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDecision) {
      await tx.issueRecommendation.updateMany({
        where: { issueId: recommendation.issueId, id: { not: recommendationId } },
        data: { isDecision: false },
      });
    }
    return tx.issueRecommendation.update({ where: { id: recommendationId }, data: { isDecision: parsed.data.isDecision } });
  });
  return NextResponse.json(updated);
}
