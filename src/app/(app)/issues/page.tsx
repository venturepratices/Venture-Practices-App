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
    // Recommendations come down with the list rather than being fetched when a
    // card is opened: a card expands in place, so a per-card request would put
    // a spinner inside every expand. This is a leadership-only list of tens of
    // rows, not a paginated feed, so the extra rows are cheap.
    prisma.issue.findMany({
      where: { archivedAt: null },
      include: {
        client: { select: { id: true, name: true } },
        raisedBy: { select: { id: true, name: true } },
        recommendations: {
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
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
        description: issue.description,
        kind: issue.kind,
        status: issue.status,
        topRank: issue.topRank,
        client: issue.client,
        raisedBy: issue.raisedBy,
        convertedTaskId: issue.convertedTaskId,
        rockId: issue.rockId,
        createdAt: issue.createdAt.toISOString(),
        solvedAt: issue.solvedAt?.toISOString() ?? null,
        recommendations: issue.recommendations.map((rec) => ({
          id: rec.id,
          body: rec.body,
          isDecision: rec.isDecision,
          createdAt: rec.createdAt.toISOString(),
          author: rec.author,
        })),
      }))}
    />
  );
}
