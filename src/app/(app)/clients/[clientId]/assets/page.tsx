import { notFound } from "next/navigation";
import { Plus } from "lucide-react";

import { canUseCapability, requireClientAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/info-tip";
import { AssetCard } from "@/components/assets/asset-card";
import { NewAssetDialog } from "@/components/assets/new-asset-dialog";

export default async function ClientAssetsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

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

  const [assets, canUpload] = await Promise.all([
    prisma.asset.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          select: { id: true, versionNumber: true, kind: true, blobUrl: true, externalUrl: true },
        },
      },
    }),
    canUseCapability("canUploadAssets"),
  ]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Assets
            <InfoTip>
              Upload creative for review. Reviewers can drop pinned comments and approve or request changes. Supports
              images, video, PDFs, and website URLs.
            </InfoTip>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything this client is reviewing. Click a card to open the viewer.
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

      {assets.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No assets yet.{" "}
            {canUpload ? "Click “New asset” to upload creative for review." : "Ask an admin for upload access."}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => (
            <AssetCard key={asset.id} clientId={clientId} asset={asset} />
          ))}
        </div>
      )}
    </div>
  );
}
