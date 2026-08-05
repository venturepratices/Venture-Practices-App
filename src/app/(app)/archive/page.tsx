import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Archive, GitBranch } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { campaignLabel } from "@/lib/campaign-stage";
import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatDateTime, endOfDay } from "@/lib/utils";
import { ArchiveFilters } from "@/components/archive/archive-filters";
import { ArchivedTaskDetailPanel } from "@/components/archive/archived-task-detail-panel";
import { ArchivedTaskRow } from "@/components/archive/archived-task-row";
import { RestoreArchivedEntityButton } from "@/components/archive/restore-archived-entity-button";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";

type SearchParams = {
  tab?: string;
  q?: string;
  status?: string;
  clientName?: string;
  deletedById?: string;
  deletedFrom?: string;
  deletedTo?: string;
};

export default async function ArchivePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!(await canUseCapability("canViewArchive"))) notFound();

  const params = await searchParams;
  const tab = params.tab === "campaigns" || params.tab === "projects" ? params.tab : "tasks";

  return (
    <div>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Archive
          <InfoTip>
            Deleted tasks, Direct Mail campaigns, and projects are never truly gone — they land here with their final
            details, recoverable with one click.
          </InfoTip>
        </h1>
        <p className="mt-1 text-muted-foreground">Nothing here is ever truly lost.</p>
      </div>

      <div className="mt-4 flex gap-1 border-b">
        <Link
          href="/archive?tab=tasks"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            tab === "tasks" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
          }`}
        >
          Tasks
        </Link>
        <Link
          href="/archive?tab=campaigns"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            tab === "campaigns" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
          }`}
        >
          Direct Mail
        </Link>
        <Link
          href="/archive?tab=projects"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            tab === "projects" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
          }`}
        >
          Projects
        </Link>
      </div>

      {tab === "tasks" ? <TasksTab params={params} /> : tab === "campaigns" ? <CampaignsTab /> : <ProjectsTab />}
    </div>
  );
}

async function TasksTab({ params }: { params: SearchParams }) {
  const where: Prisma.ArchivedTaskWhereInput = {};
  if (params.q) where.title = { contains: params.q, mode: "insensitive" };
  if (params.status) where.status = params.status as Prisma.ArchivedTaskWhereInput["status"];
  if (params.clientName === "INTERNAL") where.clientName = null;
  else if (params.clientName) where.clientName = params.clientName;
  if (params.deletedById) where.deletedById = params.deletedById;
  if (params.deletedFrom || params.deletedTo) {
    where.deletedAt = {
      ...(params.deletedFrom ? { gte: new Date(params.deletedFrom) } : {}),
      ...(params.deletedTo ? { lte: endOfDay(params.deletedTo) } : {}),
    };
  }

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
  const hasFilters = Boolean(
    params.q || params.status || params.clientName || params.deletedById || params.deletedFrom || params.deletedTo
  );

  return (
    <div>
      <div className="mt-4">
        <ArchiveFilters clientNames={clientNames} teamMembers={teamMembers} />
      </div>

      <div className="mt-4 rounded-lg border divide-y">
        {archivedTasks.length === 0 ? (
          <EmptyState
            icon={Archive}
            title={hasFilters ? "No archived tasks match these filters." : "Nothing has been deleted yet."}
          />
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

async function CampaignsTab() {
  const archivedCampaigns = await prisma.archivedCampaign.findMany({
    orderBy: { deletedAt: "desc" },
    take: 100,
    include: { deletedBy: { select: { name: true } } },
  });

  return (
    <div className="mt-4 rounded-lg border divide-y">
      {archivedCampaigns.length === 0 ? (
        <EmptyState icon={Archive} title="No deleted Direct Mail campaigns." />
      ) : (
        archivedCampaigns.map((campaign) => (
          <div key={campaign.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-medium">{campaignLabel(campaign)}</p>
              <p className="text-sm text-muted-foreground">{campaign.clientName ?? "Unknown client"}</p>
              <p className="text-xs text-muted-foreground">
                Deleted {formatDateTime(campaign.deletedAt)}
                {campaign.deletedBy ? ` by ${campaign.deletedBy.name}` : ""}
              </p>
            </div>
            <RestoreArchivedEntityButton
              restoreUrl={`/api/archived-campaigns/${campaign.id}/restore`}
              confirmMessage={`Restore "${campaignLabel(campaign)}" back to ${campaign.clientName ?? "its client"}?`}
            />
          </div>
        ))
      )}
    </div>
  );
}

async function ProjectsTab() {
  const archivedInstances = await prisma.archivedWorkflowInstance.findMany({
    orderBy: { deletedAt: "desc" },
    take: 100,
    include: { deletedBy: { select: { name: true } } },
  });

  return (
    <div className="mt-4 rounded-lg border divide-y">
      {archivedInstances.length === 0 ? (
        <EmptyState icon={GitBranch} title="No deleted projects." />
      ) : (
        archivedInstances.map((instance) => (
          <div key={instance.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-medium">{instance.name}</p>
              <p className="text-sm text-muted-foreground">
                {instance.clientName ?? "Internal"}
                {instance.archivedTaskCount > 0
                  ? ` — ${instance.archivedTaskCount} task${instance.archivedTaskCount === 1 ? "" : "s"} archived alongside it`
                  : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                Deleted {formatDateTime(instance.deletedAt)}
                {instance.deletedBy ? ` by ${instance.deletedBy.name}` : ""}
              </p>
            </div>
            <RestoreArchivedEntityButton
              restoreUrl={`/api/archived-workflow-instances/${instance.id}/restore`}
              confirmMessage={`Restore "${instance.name}"? Its archived tasks (if any) are restored separately from the Tasks tab.`}
            />
          </div>
        ))
      )}
    </div>
  );
}
