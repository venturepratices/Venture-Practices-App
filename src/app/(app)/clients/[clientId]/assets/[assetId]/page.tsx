import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { DEFAULT_ANNOTATION_COLOR, type Annotation } from "@/lib/asset-annotation";
import { canUseCapability, requireClientAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AssetViewer, type ViewerComment } from "@/components/assets/asset-viewer";
import type { ReviewerRow } from "@/components/assets/reviewer-panel";

/**
 * Asset detail — the multi-format review viewer with markup tools. Server
 * component: loads the asset, its versions, and the comments for the
 * currently-selected version (?v=<versionNumber>, defaults to the latest),
 * then hands off to the client-side <AssetViewer> for the interactive media +
 * annotation UI.
 */
export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; assetId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { clientId, assetId } = await params;
  const { v } = await searchParams;

  try {
    await requireClientAccess(clientId);
  } catch {
    notFound();
  }
  if (!(await canUseCapability("canViewAssets"))) notFound();

  const session = await auth();

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, clientId },
    include: {
      versions: { orderBy: { versionNumber: "desc" } },
      createdBy: { select: { name: true } },
    },
  });
  if (!asset || asset.versions.length === 0) notFound();

  // Selected version: ?v=<versionNumber> if valid, else the latest.
  const requestedNumber = v ? Number(v) : null;
  const selectedVersion =
    (requestedNumber != null && asset.versions.find((ver) => ver.versionNumber === requestedNumber)) ||
    asset.versions[0];
  const latestVersion = asset.versions[0];
  const isLatestVersion = selectedVersion.id === latestVersion.id;

  const rawComments = await prisma.assetComment.findMany({
    where: { versionId: selectedVersion.id },
    orderBy: { createdAt: "asc" },
    include: {
      reviewer: { select: { teamMember: { select: { name: true } }, clientUser: { select: { name: true } }, guestName: true } },
    },
  });

  const [canComment, canUpload, canManageReviewers, canDecide, canShare, folders] = await Promise.all([
    canUseCapability("canCommentOnAssets"),
    canUseCapability("canUploadAssets"),
    canUseCapability("canManageAssetReviewers"),
    canUseCapability("canDecideOnAssets"),
    canUseCapability("canShareAssetsExternally"),
    prisma.assetFolder.findMany({ where: { clientId }, orderBy: { name: "asc" } }),
  ]);

  const reviewersRaw = await prisma.assetReviewer.findMany({
    where: { assetId: asset.id },
    orderBy: { createdAt: "asc" },
    include: {
      teamMember: { select: { id: true, name: true } },
      clientUser: { select: { id: true, name: true } },
      decisions: { where: { versionId: selectedVersion.id }, select: { decision: true, note: true } },
    },
  });
  const reviewers: ReviewerRow[] = reviewersRaw.map((r) => ({
    id: r.id,
    name: r.teamMember?.name ?? r.clientUser?.name ?? r.guestName ?? "Guest reviewer",
    isGuest: r.teamMemberId == null && r.clientUserId == null,
    isMe:
      (r.teamMemberId != null && r.teamMemberId === session?.user?.id) ||
      (r.clientUserId != null && r.clientUserId === session?.user?.id),
    decision: r.decisions[0]?.decision ?? null,
    note: r.decisions[0]?.note ?? null,
  }));

  const teamMemberOptions = await prisma.teamMember.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const imageVersions = asset.versions
    .filter((ver) => ver.kind === "IMAGE" && ver.blobUrl)
    .map((ver) => ({ versionNumber: ver.versionNumber, blobUrl: ver.blobUrl! }));

  // Flatten into top-level comments each carrying their replies, and number the
  // anchored (annotated/timecoded/paged) top-level ones — that number is what
  // shows on both the marker/shape and the matching sidebar card.
  const reviewerName = (c: (typeof rawComments)[number]) =>
    c.reviewer.teamMember?.name ?? c.reviewer.clientUser?.name ?? c.reviewer.guestName ?? "Someone";

  // Rows created before the annotation toolbar only have pinX/pinY — synthesize
  // an equivalent single-point "pin" annotation so the viewer has one shape to
  // render regardless of which Slice created the row.
  function resolveAnnotation(c: (typeof rawComments)[number]): Annotation | null {
    if (c.annotation) return c.annotation as unknown as Annotation;
    if (c.pinX != null && c.pinY != null) {
      return { type: "pin", color: DEFAULT_ANNOTATION_COLOR, points: [{ x: c.pinX, y: c.pinY }] };
    }
    return null;
  }

  const topLevel = rawComments.filter((c) => !c.parentId);
  let markerSeq = 0;
  const comments: ViewerComment[] = topLevel.map((c) => {
    const annotation = resolveAnnotation(c);
    const isAnchored = annotation != null || c.timecodeMs != null || c.page != null;
    const marker = isAnchored ? ++markerSeq : null;
    return {
      id: c.id,
      body: c.body,
      author: reviewerName(c),
      createdAt: c.createdAt.toISOString(),
      annotation,
      timecodeMs: c.timecodeMs,
      page: c.page,
      resolved: c.resolvedAt != null,
      marker,
      replies: rawComments
        .filter((r) => r.parentId === c.id)
        .map((r) => ({
          id: r.id,
          body: r.body,
          author: reviewerName(r),
          createdAt: r.createdAt.toISOString(),
        })),
    };
  });

  return (
    <div className="-m-6 h-full">
      <AssetViewer
        clientId={clientId}
        assetId={asset.id}
        title={asset.title}
        description={asset.description}
        status={asset.status}
        createdByName={asset.createdBy?.name ?? null}
        version={{
          id: selectedVersion.id,
          versionNumber: selectedVersion.versionNumber,
          kind: selectedVersion.kind,
          blobUrl: selectedVersion.blobUrl,
          externalUrl: selectedVersion.externalUrl,
          mimeType: selectedVersion.mimeType,
        }}
        allVersions={asset.versions.map((ver) => ({
          versionNumber: ver.versionNumber,
          kind: ver.kind,
        }))}
        comments={comments}
        canComment={canComment}
        canUpload={canUpload}
        canManageReviewers={canManageReviewers}
        canDecide={canDecide}
        canShare={canShare}
        isLatestVersion={isLatestVersion}
        reviewers={reviewers}
        teamMemberOptions={teamMemberOptions}
        imageVersions={imageVersions}
        folders={folders}
        currentFolderId={asset.folderId}
        apiBase={`/api/assets/${asset.id}`}
        resolveCommentBase="/api/asset-comments"
        versionSwitchBase={`/clients/${clientId}/assets/${asset.id}`}
        backHref={`/clients/${clientId}/assets`}
      />
    </div>
  );
}
