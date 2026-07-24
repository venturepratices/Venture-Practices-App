import { notFound } from "next/navigation";
import { Plus } from "lucide-react";

import { AssetDecisionValue } from "@/generated/prisma/enums";
import { canUseCapability, requireClientAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/info-tip";
import { AssetFilters } from "@/components/assets/asset-filters";
import { AssetFolderSidebar } from "@/components/assets/asset-folder-sidebar";
import { AssetFolderToggleButton } from "@/components/assets/asset-folder-toggle-button";
import { AssetRow, type AssetRowData } from "@/components/assets/asset-row";
import { AssetSidebarProvider } from "@/components/assets/asset-sidebar-context";
import { NewAssetDialog } from "@/components/assets/new-asset-dialog";

const STATUS_VALUES = ["DRAFT", "IN_REVIEW", "APPROVED", "CHANGES_REQUESTED"] as const;
const KIND_VALUES = ["IMAGE", "VIDEO", "PDF", "WEBSITE", "OTHER"] as const;

const APPROVED_LIKE: AssetDecisionValue[] = [AssetDecisionValue.APPROVED, AssetDecisionValue.APPROVED_WITH_CHANGES];

type SearchParams = {
  folderId?: string;
  view?: string;
  q?: string;
  status?: string;
  kind?: string;
  reviewerId?: string;
  dueFrom?: string;
  dueTo?: string;
};

export default async function ClientAssetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { clientId } = await params;
  const filters = await searchParams;

  // Layout already gates `canAccessClient`, but tab pages should also gate the
  // per-feature `canViewAssets` cap so someone with client access but no assets
  // permission can't URL-jump here.
  try {
    await requireClientAccess(clientId);
  } catch {
    notFound();
  }
  const canView = await canUseCapability("canViewAssets");
  if (!canView) notFound();

  const [canUpload, canManage] = await Promise.all([
    canUseCapability("canUploadAssets"),
    canUseCapability("canManageAssetReviewers"),
  ]);

  const isArchivedView = filters.view === "archived";
  // ARCHIVED is deliberately unreachable through the status filter — the
  // sidebar's "Archived" entry is the only way in, so there's one clear path.
  const activeStatus =
    !isArchivedView && filters.status && (STATUS_VALUES as readonly string[]).includes(filters.status)
      ? (filters.status as (typeof STATUS_VALUES)[number])
      : undefined;
  const activeKind =
    filters.kind && (KIND_VALUES as readonly string[]).includes(filters.kind) ? filters.kind : undefined;

  const where = {
    clientId,
    ...(isArchivedView ? { status: "ARCHIVED" as const } : activeStatus ? { status: activeStatus } : { status: { not: "ARCHIVED" as const } }),
    ...(!isArchivedView && filters.folderId ? { folderId: filters.folderId } : {}),
    ...(filters.q
      ? { OR: [{ title: { contains: filters.q, mode: "insensitive" as const } }, { description: { contains: filters.q, mode: "insensitive" as const } }] }
      : {}),
    ...(filters.dueFrom || filters.dueTo
      ? {
          dueDate: {
            ...(filters.dueFrom ? { gte: new Date(filters.dueFrom) } : {}),
            ...(filters.dueTo ? { lte: endOfDay(filters.dueTo) } : {}),
          },
        }
      : {}),
  };

  const [assetsRaw, folderRows, folderCounts, allCount, archivedCount, teamMembers] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, versionNumber: true, kind: true, blobUrl: true, externalUrl: true } },
        _count: { select: { versions: true } },
        reviewers: { select: { teamMemberId: true, decisions: { select: { decision: true, versionId: true } } } },
      },
    }),
    prisma.assetFolder.findMany({ where: { clientId }, orderBy: { name: "asc" } }),
    prisma.asset.groupBy({ by: ["folderId"], where: { clientId, status: { not: "ARCHIVED" } }, _count: { _all: true } }),
    prisma.asset.count({ where: { clientId, status: { not: "ARCHIVED" } } }),
    prisma.asset.count({ where: { clientId, status: "ARCHIVED" } }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // Format and reviewer filters need the joined latest-version/reviewer data,
  // which isn't a plain column — applied here rather than in the Prisma
  // `where` clause. Fine at this scale (per-client asset counts are small).
  const assets = assetsRaw.filter((a) => {
    if (activeKind && (a.versions[0]?.kind ?? "OTHER") !== activeKind) return false;
    if (filters.reviewerId && !a.reviewers.some((r) => r.teamMemberId === filters.reviewerId)) return false;
    return true;
  });

  const folders = folderRows.map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    count: folderCounts.find((c) => c.folderId === f.id)?._count._all ?? 0,
  }));

  const rows: AssetRowData[] = assets.map((a) => {
    const latest = a.versions[0];
    const latestDecisions = latest ? a.reviewers.flatMap((r) => r.decisions.filter((d) => d.versionId === latest.id)) : [];
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      status: a.status,
      dueDate: a.dueDate,
      currentVersion: latest ? { versionNumber: latest.versionNumber, kind: latest.kind, blobUrl: latest.blobUrl } : null,
      versionCount: a._count.versions,
      reviewerCount: a.reviewers.length,
      approvedCount: latestDecisions.filter((d) => APPROVED_LIKE.includes(d.decision)).length,
      changesRequested: latestDecisions.some((d) => d.decision === AssetDecisionValue.CHANGES_REQUESTED),
    };
  });

  const hasFilters = Boolean(filters.q || activeStatus || activeKind || filters.reviewerId || filters.dueFrom || filters.dueTo);
  const hasAnyAssets = allCount > 0 || archivedCount > 0;

  let emptyMessage: string;
  if (isArchivedView) {
    emptyMessage = "Nothing archived yet.";
  } else if (hasFilters) {
    emptyMessage = "No assets match these filters.";
  } else if (filters.folderId) {
    emptyMessage = "No assets in this folder yet.";
  } else if (!hasAnyAssets) {
    emptyMessage = `No assets yet. ${canUpload ? 'Click "New asset" to upload creative for review.' : "Ask an admin for upload access."}`;
  } else {
    emptyMessage = "No assets here yet.";
  }

  return (
    <div className="-m-6 flex h-full flex-col">
      <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Assets
            <InfoTip>
              Upload creative for review. Reviewers can drop pinned comments and approve or request changes. Supports
              images, video, PDFs, and website URLs.
            </InfoTip>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Everything this client is reviewing. Click an asset to open the viewer.
          </p>
        </div>
        {canUpload ? (
          <NewAssetDialog
            clientId={clientId}
            trigger={
              <Button>
                <Plus className="size-4" />
                New asset
              </Button>
            }
          />
        ) : null}
      </div>

      <AssetSidebarProvider>
      <div className="flex min-h-0 flex-1">
        <AssetFolderSidebar clientId={clientId} folders={folders} allCount={allCount} archivedCount={archivedCount} canManage={canManage} />

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <AssetFolderToggleButton />
            <AssetFilters teamMembers={teamMembers} />
          </div>

          {rows.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            </div>
          ) : (
            <div className="rounded-lg border divide-y">
              {rows.map((asset) => (
                <AssetRow key={asset.id} clientId={clientId} asset={asset} />
              ))}
            </div>
          )}
        </div>
      </div>
      </AssetSidebarProvider>
    </div>
  );
}
