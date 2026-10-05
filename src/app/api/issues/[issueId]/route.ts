import { NextResponse } from "next/server";

import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateIssueSchema } from "@/lib/validations/leadership";

type Params = { params: Promise<{ issueId: string }> };

async function findLiveIssue(issueId: string) {
  return prisma.issue.findFirst({ where: { id: issueId, archivedAt: null } });
}

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireCapability("canUseLeadership");
  } catch (error) {
    return toErrorResponse(error);
  }
  const { issueId } = await params;
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, archivedAt: null },
    include: {
      client: { select: { id: true, name: true } },
      raisedBy: { select: { id: true, name: true } },
      recommendations: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(issue);
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireCapability("canUseLeadership");
  } catch (error) {
    return toErrorResponse(error);
  }
  const { issueId } = await params;
  const issue = await findLiveIssue(issueId);
  if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = updateIssueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { status, topRank, clientId, ...rest } = parsed.data;

  if (clientId) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "That client doesn't exist." }, { status: 400 });
  }

  const data: Record<string, unknown> = { ...rest };
  if (clientId !== undefined) data.clientId = clientId;
  if (status !== undefined) {
    data.status = status;
    data.solvedAt = status === "SOLVED" ? new Date() : null;
    // A solved issue leaves the Top 3 so the slot frees up for next week.
    if (status === "SOLVED") data.topRank = null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (topRank !== undefined && status !== "SOLVED") {
      // Each Top 3 slot holds one issue: whoever had this slot swaps into
      // this issue's old slot (or drops out of the Top 3 if it had none).
      if (topRank !== null && topRank !== issue.topRank) {
        await tx.issue.updateMany({
          where: { topRank, status: "OPEN", archivedAt: null, id: { not: issueId } },
          data: { topRank: issue.topRank },
        });
      }
      data.topRank = topRank;
    }
    return tx.issue.update({ where: { id: issueId }, data });
  });

  return NextResponse.json(updated);
}

// "Remove" — archived, not hard-deleted (see ARCHITECTURE.md's soft-delete
// rule); it just disappears from the list.
export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireCapability("canUseLeadership");
  } catch (error) {
    return toErrorResponse(error);
  }
  const { issueId } = await params;
  const issue = await findLiveIssue(issueId);
  if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.issue.update({ where: { id: issueId }, data: { archivedAt: new Date(), topRank: null } });
  return NextResponse.json({ ok: true });
}
