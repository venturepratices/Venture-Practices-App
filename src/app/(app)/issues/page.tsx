import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { LEADERSHIP_MEMBER_WHERE } from "@/lib/leadership";
import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { IssuesBoard } from "@/components/leadership/issues-board";

export default async function IssuesPage() {
  if (!(await canUseCapability("canUseLeadership"))) notFound();
  const session = await auth();

  const [issues, clients, teamMembers, leadershipMembers] = await Promise.all([
    prisma.issue.findMany({
      where: { archivedAt: null },
      include: {
        client: { select: { id: true, name: true } },
        raisedBy: { select: { id: true, name: true } },
        _count: { select: { recommendations: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.teamMember.findMany({ where: LEADERSHIP_MEMBER_WHERE, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <IssuesBoard
      currentUserId={session?.user?.id ?? null}
      clients={clients}
      teamMembers={teamMembers}
      leadershipMembers={leadershipMembers}
      issues={issues.map((issue) => ({
        id: issue.id,
        title: issue.title,
        kind: issue.kind,
        status: issue.status,
        topRank: issue.topRank,
        client: issue.client,
        raisedBy: issue.raisedBy,
        recommendationCount: issue._count.recommendations,
        createdAt: issue.createdAt.toISOString(),
        solvedAt: issue.solvedAt?.toISOString() ?? null,
      }))}
    />
  );
}
