import { NextResponse } from "next/server";

import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createIssueSchema } from "@/lib/validations/leadership";

// Leadership Issues List. Deliberately NOT written to ActivityLog: that feed
// is visible to anyone with canViewActivity, while issues can touch finances
// and are meant for the Leadership group only.
export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireCapability("canUseLeadership")).userId;
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createIssueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;

  if ("titles" in data) {
    // The list is newest-first, so each line is stamped 1ms older than the
    // one above it — the pasted order survives instead of shuffling on a tie.
    const now = Date.now();
    const result = await prisma.issue.createMany({
      data: data.titles.map((title, i) => ({
        title,
        kind: data.kind ?? "PROBLEM",
        raisedById: userId,
        createdAt: new Date(now - i),
      })),
    });
    return NextResponse.json({ created: result.count }, { status: 201 });
  }

  if (data.clientId) {
    const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "That client doesn't exist." }, { status: 400 });
  }

  const issue = await prisma.issue.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      kind: data.kind ?? "PROBLEM",
      clientId: data.clientId ?? null,
      raisedById: userId,
    },
  });
  return NextResponse.json(issue, { status: 201 });
}
