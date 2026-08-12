import { notFound } from "next/navigation";
import Link from "next/link";
import { Archive, CheckCircle2 } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/info-tip";
import { NewPlanningItemForm } from "@/components/planning/new-planning-item-form";
import { PlanningIdeasList } from "@/components/planning/planning-ideas-list";
import { PlanningItemDetailPanel } from "@/components/planning/planning-item-detail-panel";
import { PlanningFilters } from "@/components/planning/planning-filters";
import { PlanningFolderSidebar } from "@/components/planning/planning-folder-sidebar";

type SearchParams = {
  tab?: string;
  folderId?: string;
  q?: string;
  status?: string;
  from?: string;
  to?: string;
};

const TABS = [
  { key: "ideas", label: "Ideas" },
  { key: "archive", label: "Archive" },
  { key: "converted", label: "Converted to task" },
] as const;

export default async function PlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { clientId } = await params;
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "ideas";

  // Client-access is enforced by the layout; this adds the Planning capability.
  if (!(await canUseCapability("canViewPlanning"))) notFound();
  const canManage = await canUseCapability("canManagePlanning");

  const statusFilter: Prisma.PlanningItemWhereInput["status"] =
    tab === "archive"
      ? { in: ["ARCHIVED"] }
      : tab === "converted"
        ? { in: ["CONVERTED"] }
        : sp.status === "IDEA" || sp.status === "STRATEGY"
          ? { in: [sp.status] }
          : { in: ["IDEA", "STRATEGY"] };

  const where: Prisma.PlanningItemWhereInput = {
    clientId,
    status: statusFilter,
    ...(tab === "ideas" && sp.folderId ? { folderId: sp.folderId } : {}),
    ...(sp.q
      ? { OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { description: { contains: sp.q, mode: "insensitive" } }] }
      : {}),
    ...(sp.from || sp.to
      ? { createdAt: { ...(sp.from ? { gte: new Date(sp.from) } : {}), ...(sp.to ? { lte: new Date(`${sp.to}T23:59:59`) } : {}) } }
      : {}),
  };

  const [items, teamMembers, folders, allIdeasCount] = await Promise.all([
    prisma.planningItem.findMany({
      where,
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    tab === "ideas"
      ? prisma.planningFolder.findMany({
          where: { clientId },
          orderBy: { name: "asc" },
          include: { _count: { select: { items: { where: { status: { in: ["IDEA", "STRATEGY"] } } } } } },
        })
      : Promise.resolve([]),
    tab === "ideas" ? prisma.planningItem.count({ where: { clientId, status: { in: ["IDEA", "STRATEGY"] } } }) : Promise.resolve(0),
  ]);

  const folderItems = folders.map((f) => ({ id: f.id, name: f.name, color: f.color, count: f._count.items }));
  const emptyLabel =
    tab === "archive" ? "Nothing archived yet." : tab === "converted" ? "Nothing converted to a task yet." : "No ideas yet — add one above.";

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Planning
          <InfoTip>
            A place to park half-formed ideas for this client, separate from real tasks. Move an idea to &quot;Strategy&quot;
            once it&apos;s more solid, &quot;Move to task&quot; once someone&apos;s ready to work on it (you&apos;ll pick who), or &quot;Move to
            Archive&quot; if it&apos;s not happening.
          </InfoTip>
        </h2>
      </div>

      <div className="mt-4 flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "ideas" ? `/clients/${clientId}/planning` : `/clients/${clientId}/planning?tab=${t.key}`}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.key === "archive" ? <Archive className="size-3.5" /> : t.key === "converted" ? <CheckCircle2 className="size-3.5" /> : null}
            {t.label}
          </Link>
        ))}
      </div>

      {canManage && tab === "ideas" ? (
        <div className="mt-4">
          <NewPlanningItemForm clientId={clientId} />
        </div>
      ) : null}

      {tab === "ideas" ? (
        <div className="mt-4">
          <PlanningFilters />
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-4 md:flex-row">
        {tab === "ideas" ? (
          <PlanningFolderSidebar clientId={clientId} folders={folderItems} allCount={allIdeasCount} canManage={canManage} />
        ) : null}

        <div className="min-w-0 flex-1 rounded-lg border">
          <PlanningIdeasList
            clientId={clientId}
            items={items}
            teamMembers={teamMembers}
            canManage={canManage}
            folders={folderItems}
            tab={tab}
            emptyLabel={emptyLabel}
          />
        </div>
      </div>

      <PlanningItemDetailPanel clientId={clientId} teamMembers={teamMembers} folders={folderItems} canManage={canManage} />
    </div>
  );
}
