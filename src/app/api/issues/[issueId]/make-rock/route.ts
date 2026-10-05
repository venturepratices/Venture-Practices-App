import { NextResponse } from "next/server";

import { LEADERSHIP_MEMBER_WHERE, quarterKeyFor, quarterRange } from "@/lib/leadership";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { issueToRockSchema } from "@/lib/validations/leadership";

// "Make it a Rock" — when an issue is too big to solve in a week, it becomes
// a 90-day priority for the current quarter. The issue stays on the list with
// a link to its Rock until someone marks it solved.
export async function POST(request: Request, { params }: { params: Promise<{ issueId: string }> }) {
  let userId: string;
  try {
    userId = (await requireCapability("canUseLeadership")).userId;
  } catch (error) {
    return toErrorResponse(error);
  }
  const { issueId } = await params;
  const issue = await prisma.issue.findFirst({ where: { id: issueId, archivedAt: null } });
  if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = issueToRockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const owner = await prisma.teamMember.findFirst({ where: { id: parsed.data.ownerId, ...LEADERSHIP_MEMBER_WHERE }, select: { id: true } });
  if (!owner) return NextResponse.json({ error: "Rock owners need access to Issues & Rocks." }, { status: 400 });

  const quarter = quarterKeyFor();
  const rock = await prisma.rock.create({
    data: {
      title: issue.title,
      doneDefinition: null,
      quarter,
      dueDate: quarterRange(quarter).end,
      isCompany: parsed.data.isCompany ?? false,
      ownerId: owner.id,
      createdById: userId,
    },
  });
  await prisma.issue.update({ where: { id: issueId }, data: { rockId: rock.id } });

  return NextResponse.json({ rock: { id: rock.id } }, { status: 201 });
}
