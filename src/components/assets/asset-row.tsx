import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, File, FileText, Film, Globe, Image as ImageIcon } from "lucide-react";

import { ASSET_ROW_GRID } from "@/components/assets/asset-row-grid";
import { AssetStatusPill } from "@/components/assets/asset-status-pill";
import { cn } from "@/lib/utils";

export type AssetRowData = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: Date | null;
  currentVersion: { versionNumber: number; kind: string; blobUrl: string | null } | null;
  versionCount: number;
  reviewerCount: number;
  approvedCount: number;
  changesRequested: boolean;
};

const KIND_LABELS: Record<string, string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  PDF: "PDF",
  WEBSITE: "Website",
  OTHER: "Other",
};

function FormatIcon({ kind, className }: { kind: string; className?: string }) {
  switch (kind) {
    case "VIDEO":
      return <Film className={className} />;
    case "PDF":
      return <FileText className={className} />;
    case "WEBSITE":
      return <Globe className={className} />;
    case "IMAGE":
      return <ImageIcon className={className} />;
    default:
      return <File className={className} />;
  }
}

/**
 * One row in the Assets list — small thumbnail, title + one-line description
 * (visually distinct per the typography scale: bold title, smaller muted
 * description directly underneath), then fixed columns for status/format/
 * version/approval progress/due date. Mirrors the layout convention already
 * proven on the Archive page (src/components/archive/archived-task-row.tsx),
 * just with a thumbnail column and a click-through Link instead of a
 * query-param detail panel.
 */
export function AssetRow({ clientId, asset }: { clientId: string; asset: AssetRowData }) {
  const kind = asset.currentVersion?.kind ?? "OTHER";
  const isImage = kind === "IMAGE" && !!asset.currentVersion?.blobUrl;

  return (
    <Link
      href={`/clients/${clientId}/assets/${asset.id}`}
      className={cn(
        ASSET_ROW_GRID,
        "w-full animate-in items-center px-3 py-2.5 text-sm fade-in slide-in-from-bottom-1 transition-colors duration-300 hover:bg-muted"
      )}
    >
      <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {isImage ? (
          <Image src={asset.currentVersion!.blobUrl!} alt="" fill sizes="48px" className="object-cover" />
        ) : (
          <FormatIcon kind={kind} className="size-5 text-muted-foreground/60" />
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{asset.title}</p>
        {asset.description ? (
          <p className="truncate text-xs text-muted-foreground">{asset.description}</p>
        ) : null}
        <p className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
          {[
            KIND_LABELS[kind],
            `v${asset.currentVersion?.versionNumber ?? 1}`,
            asset.changesRequested
              ? "Changes requested"
              : asset.reviewerCount > 0
                ? `${asset.approvedCount}/${asset.reviewerCount} approved`
                : null,
            asset.dueDate ? `Due ${asset.dueDate.toLocaleDateString()}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <AssetStatusPill status={asset.status} className="justify-self-start" />

      <span className="hidden truncate text-xs text-muted-foreground md:block">{KIND_LABELS[kind]}</span>

      <span className="hidden truncate text-xs text-muted-foreground md:block">
        v{asset.currentVersion?.versionNumber ?? 1}
        {asset.versionCount > 1 ? ` (${asset.versionCount})` : ""}
      </span>

      <span className="hidden text-xs md:block">
        {asset.changesRequested ? (
          <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="size-3.5" />
            Changes requested
          </span>
        ) : asset.reviewerCount > 0 ? (
          <span className="text-muted-foreground">
            {asset.approvedCount}/{asset.reviewerCount} approved
          </span>
        ) : (
          <span className="text-muted-foreground">No reviewers</span>
        )}
      </span>

      <span className="hidden justify-self-end text-right text-xs text-muted-foreground md:block">
        {asset.dueDate ? `Due ${asset.dueDate.toLocaleDateString()}` : "—"}
      </span>
    </Link>
  );
}
