import { notFound, redirect } from "next/navigation";

import { DEFAULT_ANNOTATION_COLOR, type Annotation } from "@/lib/asset-annotation";
import { getClientUserSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AssetViewer, type ViewerComment } from "@/components/assets/asset-viewer";
import type { ReviewerRow } from "@/components/assets/reviewer-panel";

/**
 * Client-portal asset viewer (Slice 4b) — same <AssetViewer> component the
 * agency side and the guest share-link surface both use, just pointed at the
 * internal API routes (which now accept a ClientUser session as an
 * alternative to a TeamMember one — see resolveAssetActor in
 * src/lib/permissions.ts) with upload/reviewer-management/share hidden.
 * Visibility rule: only this client's own assets, and never a DRAFT one.
 */
export default async function PortalAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const clientUser = await getClientUserSession();
  if (!clientUser) redirect("/login");

  const { assetId } = await params;
  const { v } = await searchParams;

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  if (!asset || asset.clientId !== clientUser.clientId || asset.status === "DRAFT" || asset.versions.length === 0) {
    notFound();
  }

  // Ensure this client user has a reviewer row on their very first visit —
  // otherwise "Make your decision" wouldn't appear until after their first
  // comment (which lazily creates one too), same fix the guest share-link
  // flow gets via its explicit identify step.
  const existingReviewer = await prisma.assetReviewer.findFirst({ where: { assetId, clientUserId: clientUser.id } });
  if (!existingReviewer) {
    await prisma.assetReviewer.create({ data: { assetId, clientUserId: clientUser.id } });
  }

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
    isMe: r.clientUserId != null && r.clientUserId === clientUser.id,
    decision: r.decisions[0]?.decision ?? null,
    note: r.decisions[0]?.note ?? null,
  }));

  const reviewerName = (c: (typeof rawComments)[number]) =>
    c.reviewer.teamMember?.name ?? c.reviewer.clientUser?.name ?? c.reviewer.guestName ?? "Someone";

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
        .map((r) => ({ id: r.id, body: r.body, author: reviewerName(r), createdAt: r.createdAt.toISOString() })),
    };
  });

  const imageVersions = asset.versions
    .filter((ver) => ver.kind === "IMAGE" && ver.blobUrl)
    .map((ver) => ({ versionNumber: ver.versionNumber, blobUrl: ver.blobUrl! }));

  return (
    <div className="h-[calc(100vh-57px)]">
      <AssetViewer
        clientId={clientUser.clientId}
        assetId={asset.id}
        title={asset.title}
        description={asset.description}
        status={asset.status}
        createdByName={null}
        version={{
          id: selectedVersion.id,
          versionNumber: selectedVersion.versionNumber,
          kind: selectedVersion.kind,
          blobUrl: selectedVersion.blobUrl,
          externalUrl: selectedVersion.externalUrl,
          mimeType: selectedVersion.mimeType,
        }}
        allVersions={asset.versions.map((ver) => ({ versionNumber: ver.versionNumber, kind: ver.kind }))}
        comments={comments}
        canComment
        canUpload={false}
        canManageReviewers={false}
        canDecide
        canShare={false}
        isLatestVersion={isLatestVersion}
        reviewers={reviewers}
        teamMemberOptions={[]}
        imageVersions={imageVersions}
        apiBase={`/api/assets/${asset.id}`}
        resolveCommentBase="/api/asset-comments"
        versionSwitchBase={`/portal/assets/${asset.id}`}
        backHref="/portal"
      />
    </div>
  );
}
