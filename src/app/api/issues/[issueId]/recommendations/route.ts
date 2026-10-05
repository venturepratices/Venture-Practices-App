import { NextResponse } from "next/server";

import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createRecommendationSchema } from "@/lib/validations/leadership";

export async function POST(request: Request, { params }: { params: Promise<{ issueId: string }> }) {
  let userId: string;
  try {
    userId = (await requireCapability("canUseLeadership")).userId;
  } catch (error) {
    return toErrorResponse(error);
  }
  const { issueId } = await params;
  const issue = await prisma.issue.findFirst({ where: { id: issueId, archivedAt: null }, select: { id: true } });
  if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = createRecommendationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const recommendation = await prisma.issueRecommendation.create({
    data: { issueId, authorId: userId, body: parsed.data.body },
  });
  return NextResponse.json(recommendation, { status: 201 });
}
