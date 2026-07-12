import { Suspense } from "react";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ArchiveFilters } from "@/components/archive/archive-filters";
import { ArchivedTaskDetailPanel } from "@/components/archive/archived-task-detail-panel";
import { ArchivedTaskRow } from "@/components/archive/archived-task-row";
import { InfoTip } from "@/components/info-tip";

type SearchParams = {
  q?: string;
  status?: string;
  clientName?: string;
  deletedById?: string;
};

export default async function ArchivePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  const where: Prisma.ArchivedTaskWhereInput = {};
  if (params.q) where.title = { contains: params.q, mode: "insensitive" };
  if (params.status) where.status = params.status as Prisma.ArchivedTaskWhereInput["status"];
  if (params.clientName === "INTERNAL") where.clientName = null;
  else if (params.clientName) where.clientName = params.clientName;
  if (params.deletedById) where.deletedById = params.deletedById;

  const [archivedTasks, clientNameRows, teamMembers] = await Promise.all([
    prisma.archivedTask.findMany({
      where,
      orderBy: { deletedAt: "desc" },
      take: 100,
      include: { deletedBy: { select: { name: true } } },
    }),
    prisma.archivedTask.findMany({
      where: { clientName: { not: null } },
      distinct: ["clientName"],
      select: { clientName: true },
      orderBy: { clientName: "asc" },
    }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const clientNames = clientNameRows.map((row) => row.clientName).filter((name): name is string => Boolean(name));
  const hasFilters = Boolean(params.q || params.status || params.clientName || params.deletedById);

  return (
    <div>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Archive
          <InfoTip>
            Deleted tasks are never truly gone — they land here with their final details, comments, and links. Click any
            row to view everything read-only. Use the search and filters to backtrack to a specific task.
          </InfoTip>
        </h1>
        <p className="mt-1 text-muted-foreground">
          Deleted tasks, kept here (and mirrored to durable storage) so nothing is ever truly lost.
        </p>
      </div>

      <div className="mt-4">
        <ArchiveFilters clientNames={clientNames} teamMembers={teamMembers} />
      </div>

      <div className="mt-4 rounded-lg border divide-y">
        {archivedTasks.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {hasFilters ? "No archived tasks match these filters." : "Nothing has been deleted yet."}
          </p>
        ) : (
          archivedTasks.map((task) => <ArchivedTaskRow key={task.id} task={task} />)
        )}
      </div>

      <Suspense fallback={null}>
        <ArchivedTaskDetailPanel />
      </Suspense>
    </div>
  );
}
