import { DEFAULT_ANNOTATION_COLOR, type Annotation } from "@/lib/asset-annotation";
import { resolveShareLinkAccess } from "@/lib/share-link";
import { prisma } from "@/lib/prisma";
import { AssetViewer, type ViewerComment } from "@/components/assets/asset-viewer";
import type { ReviewerRow } from "@/components/assets/reviewer-panel";
import { GuestIdentityBanner } from "@/components/review/guest-identity-banner";
import { PasswordGateForm } from "@/components/review/password-gate-form";

function InvalidLinkMessage({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className="text-center text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * Public, tokenized asset review page (Slice 4a) — no login, no app sidebar.
 * Everything below is derived purely from the token via
 * resolveShareLinkAccess(); no assetId/clientId ever comes from the request
 * itself, so there is no parameter a guest could tamper with to see a
 * different asset than the one their link points at.
 */
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { token } = await params;
  const { v } = await searchParams;

  const resolved = await resolveShareLinkAccess(token);
  if (!resolved.ok) {
    return (
      <InvalidLinkMessage
        message={resolved.error === "expired" ? "This review link has expired." : "This review link is no longer valid."}
      />
    );
  }
  const { access } = resolved;

  // Password gate first, before revealing anything about the asset at all.
  if (!access.passwordOk) {
    return <PasswordGateForm token={token} />;
  }

  const asset = await prisma.asset.findUnique({
    where: { id: access.link.assetId },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  if (!asset || asset.versions.length === 0) {
    return <InvalidLinkMessage message="This asset is no longer available." />;
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
    include: { reviewer: { select: { teamMember: { select: { name: true } }, guestName: true } } },
  });

  const reviewersRaw = await prisma.assetReviewer.findMany({
    where: { assetId: asset.id },
    orderBy: { createdAt: "asc" },
    include: {
      teamMember: { select: { id: true, name: true } },
      decisions: { where: { versionId: selectedVersion.id }, select: { decision: true, note: true } },
    },
  });

  const myReviewerId = access.cookiePayload?.guestReviewerId ?? null;
  const identified = myReviewerId != null;

  const reviewers: ReviewerRow[] = reviewersRaw.map((r) => ({
    id: r.id,
    name: r.teamMember?.name ?? r.guestName ?? "Guest reviewer",
    isGuest: r.teamMemberId == null,
    isMe: r.id === myReviewerId,
    decision: r.decisions[0]?.decision ?? null,
    note: r.decisions[0]?.note ?? null,
  }));

  const reviewerName = (c: (typeof rawComments)[number]) =>
    c.reviewer.teamMember?.name ?? c.reviewer.guestName ?? "Someone";

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
    <div className="flex h-[calc(100vh-49px)] flex-col">
      {!identified ? <GuestIdentityBanner token={token} /> : null}
      <div className="min-h-0 flex-1">
        <AssetViewer
          clientId=""
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
          canComment={identified}
          canUpload={false}
          canManageReviewers={false}
          canDecide={identified}
          canShare={false}
          isLatestVersion={isLatestVersion}
          reviewers={reviewers}
          teamMemberOptions={[]}
          imageVersions={imageVersions}
          apiBase={`/api/review/${token}`}
          resolveCommentBase={`/api/review/${token}/comments`}
          versionSwitchBase={`/review/${token}`}
          backHref={null}
        />
      </div>
    </div>
  );
}
