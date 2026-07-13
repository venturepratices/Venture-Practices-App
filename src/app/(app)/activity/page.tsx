import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { endOfDay, formatDateTime } from "@/lib/utils";
import { ActivityFilters } from "@/components/activity/activity-filters";
import { InfoTip } from "@/components/info-tip";

type SearchParams = {
  q?: string;
  actorId?: string;
  entityType?: string;
  range?: string;
  from?: string;
  to?: string;
};

function rangeStart(range?: string): Date | null {
  if (!range) return null;
  const start = new Date();
  if (range === "TODAY") {
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "WEEK") {
    start.setDate(start.getDate() - 7);
    return start;
  }
  if (range === "MONTH") {
    start.setDate(start.getDate() - 30);
    return start;
  }
  return null;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  const where: Prisma.ActivityLogWhereInput = {};
  if (params.q) where.description = { contains: params.q, mode: "insensitive" };
  if (params.actorId) where.actorId = params.actorId;
  if (params.entityType) where.entityType = params.entityType;
  if (params.from || params.to) {
    where.createdAt = {
      ...(params.from ? { gte: new Date(params.from) } : {}),
      ...(params.to ? { lte: endOfDay(params.to) } : {}),
    };
  } else {
    const start = rangeStart(params.range);
    if (start) where.createdAt = { gte: start };
  }

  const [entries, teamMembers] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 150,
    }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const hasFilters = Boolean(params.q || params.actorId || params.entityType || params.range || params.from || params.to);

  return (
    <div>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Activity
          <InfoTip>
            A permanent log of every action in the app — who did what, and exactly when. Use the search and filters to
            backtrack any change: filter by person, by what was affected, or by time period.
          </InfoTip>
        </h1>
        <p className="mt-1 text-muted-foreground">Every meaningful action across the agency, most recent first.</p>
      </div>

      <div className="mt-4">
        <ActivityFilters teamMembers={teamMembers} />
      </div>

      <div className="mt-4 rounded-lg border divide-y">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {hasFilters ? "No activity matches these filters." : "No activity yet."}
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{entry.description}</span>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {formatDateTime(entry.createdAt)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
