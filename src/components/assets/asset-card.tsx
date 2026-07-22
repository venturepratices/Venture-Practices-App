import Link from "next/link";
import { FileText, Film, Globe, Image as ImageIcon, File } from "lucide-react";

import { formatDateTime } from "@/lib/utils";
import { AssetStatusPill } from "@/components/assets/asset-status-pill";

/**
 * Card for the Assets tab grid. Thumbnail preview for IMAGE (uses the raw
 * blobUrl since Vercel Blob stores these as public objects); big format icon
 * for every other kind. Clickable to /clients/[clientId]/assets/[assetId]
 * (viewer page arrives in Slice 2).
 */
export function AssetCard({
  clientId,
  asset,
}: {
  clientId: string;
  asset: {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    dueDate: Date | null;
    versions: { id: string; versionNumber: number; kind: string; blobUrl: string | null; externalUrl: string | null }[];
  };
}) {
  const currentVersion = [...asset.versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const kind = currentVersion?.kind ?? "OTHER";
  const versionCount = asset.versions.length;

  return (
    <Link
      href={`/clients/${clientId}/assets/${asset.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md"
    >
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
        {kind === "IMAGE" && currentVersion?.blobUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentVersion.blobUrl}
            alt={asset.title}
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <FormatIcon kind={kind} />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 flex-1 text-sm font-medium">{asset.title}</h3>
          <AssetStatusPill status={asset.status} />
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{kindLabel(kind)}</span>
          <span>·</span>
          <span>
            v{currentVersion?.versionNumber ?? 1}
            {versionCount > 1 ? ` (${versionCount} versions)` : ""}
          </span>
          <span>·</span>
          <span>{formatDateTime(asset.createdAt)}</span>
          {asset.dueDate ? (
            <>
              <span>·</span>
              <span>Due {formatDateTime(asset.dueDate)}</span>
            </>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function FormatIcon({ kind }: { kind: string }) {
  const iconClass = "size-12 text-muted-foreground/60";
  switch (kind) {
    case "VIDEO":
      return <Film className={iconClass} />;
    case "PDF":
      return <FileText className={iconClass} />;
    case "WEBSITE":
      return <Globe className={iconClass} />;
    case "IMAGE":
      return <ImageIcon className={iconClass} />;
    default:
      return <File className={iconClass} />;
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "IMAGE":
      return "Image";
    case "VIDEO":
      return "Video";
    case "PDF":
      return "PDF";
    case "WEBSITE":
      return "Website";
    default:
      return "File";
  }
}
