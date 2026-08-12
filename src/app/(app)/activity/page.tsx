import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, History } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { accessibleClientFilter, canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { endOfDay, formatDateTime } from "@/lib/utils";
import { ActivityFilters } from "@/components/activity/activity-filters";
import { InfoTip } from "@/components/info-tip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

const PAGE_SIZE = 100;

type SearchParams = {
  q?: string;
  actorId?: string;
  entityType?: string;
  range?: string;
  from?: string;
  to?: string;
  clientId?: string;
  page?: string;
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
  if (!(await canUseCapability("canViewActivity"))) notFound();

  const params = await searchParams;

  const where: Prisma.ActivityLogWhereInput = {};
  if (params.q) where.description = { contains: params.q, mode: "insensitive" };
  if (params.actorId) where.actorId = params.actorId;
  if (params.entityType) where.entityType = params.entityType;
  if (params.clientId) where.clientId = params.clientId;
  if (params.from || params.to) {
    where.createdAt = {
      ...(params.from ? { gte: new Date(params.from) } : {}),
      ...(params.to ? { lte: endOfDay(params.to) } : {}),
    };
  } else {
    const start = rangeStart(params.range);
    if (start) where.createdAt = { gte: start };
  }

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const clientWhere = await accessibleClientFilter("id");

  const [entries, totalCount, teamMembers, clients] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.activityLog.count({ where }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.client.findMany({ where: clientWhere, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rangeStartIndex = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEndIndex = Math.min(page * PAGE_SIZE, totalCount);

  function pageHref(targetPage: number): string {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.actorId) query.set("actorId", params.actorId);
    if (params.entityType) query.set("entityType", params.entityType);
    if (params.range) query.set("range", params.range);
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    if (params.clientId) query.set("clientId", params.clientId);
    if (targetPage > 1) query.set("page", String(targetPage));
    const qs = query.toString();
    return qs ? `/activity?${qs}` : "/activity";
  }

  const hasFilters = Boolean(
    params.q || params.actorId || params.entityType || params.range || params.from || params.to || params.clientId,
  );

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
        <ActivityFilters teamMembers={teamMembers} clients={clients} />
      </div>

      <div className="mt-4 rounded-lg border divide-y">
        {entries.length === 0 ? (
          <EmptyState icon={History} title={hasFilters ? "No activity matches these filters." : "No activity yet."} />
        ) : (
          entries.map((entry, i) => (
            <div
              key={entry.id}
              style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
              className="flex animate-in items-center justify-between gap-4 fade-in slide-in-from-bottom-1 px-4 py-3 text-sm duration-300"
            >
              <span className="min-w-0 flex-1 truncate">{entry.description}</span>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {formatDateTime(entry.createdAt)}
              </span>
            </div>
          ))
        )}
      </div>

      {totalCount > 0 ? (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Showing {rangeStartIndex}–{rangeEndIndex} of {totalCount}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} render={<Link href={pageHref(page - 1)} scroll={false} />}>
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              render={<Link href={pageHref(page + 1)} scroll={false} />}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
