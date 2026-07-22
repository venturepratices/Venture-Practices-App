import { NextResponse } from "next/server";
import { z } from "zod";

import { AssetDecisionValue } from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity-log";
import { recomputeAssetStatus } from "@/lib/asset-status";
import { resolveShareLinkAccess } from "@/lib/share-link";
import { prisma } from "@/lib/prisma";

const decisionSchema = z.object({
  decision: z.enum([AssetDecisionValue.APPROVED, AssetDecisionValue.APPROVED_WITH_CHANGES, AssetDecisionValue.CHANGES_REQUESTED]),
  note: z.string().trim().max(2000).optional().nullable(),
});

function decisionLabel(v: AssetDecisionValue): string {
  switch (v) {
    case AssetDecisionValue.APPROVED:
      return "approved";
    case AssetDecisionValue.APPROVED_WITH_CHANGES:
      return "approved with changes";
    case AssetDecisionValue.CHANGES_REQUESTED:
      return "requested changes on";
  }
}

/** Guest equivalent of the internal decisions route — same latest-version-only rule, same derived-status recompute. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string; versionId: string }> }) {
  const { token, versionId } = await params;

  const resolved = await resolveShareLinkAccess(token);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error === "expired" ? "This review link has expired." : "This review link is no longer valid." },
      { status: resolved.error === "expired" ? 410 : 404 }
    );
  }
  const { access } = resolved;
  if (!access.passwordOk) {
    return NextResponse.json({ error: "This link is password protected." }, { status: 403 });
  }
  if (!access.cookiePayload?.guestReviewerId) {
    return NextResponse.json({ error: "Please enter your name and email first." }, { status: 403 });
  }

  const asset = await prisma.asset.findUnique({
    where: { id: access.link.assetId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } } },
  });
  if (!asset || asset.versions[0]?.id !== versionId) {
    return NextResponse.json({ error: "Decisions can only be made on the latest version." }, { status: 400 });
  }

  const reviewer = await prisma.assetReviewer.findFirst({
    where: { id: access.cookiePayload.guestReviewerId, assetId: access.link.assetId },
  });
  if (!reviewer) {
    return NextResponse.json({ error: "Please enter your name and email first." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const decision = await prisma.assetDecision.upsert({
    where: { versionId_reviewerId: { versionId, reviewerId: reviewer.id } },
    create: { versionId, reviewerId: reviewer.id, decision: parsed.data.decision, note: parsed.data.note ?? null },
    update: { decision: parsed.data.decision, note: parsed.data.note ?? null, decidedAt: new Date() },
  });

  const status = await recomputeAssetStatus(access.link.assetId);
  await logActivity({
    actorId: null,
    actorName: reviewer.guestName ?? "A guest reviewer",
    entityType: "Asset",
    entityId: access.link.assetId,
    entityLabel: asset.title,
    action: "decision_made",
    description: `${reviewer.guestName ?? "A guest"} ${decisionLabel(parsed.data.decision)} "${asset.title}" via a share link`,
  });

  return NextResponse.json({ decision, status }, { status: 200 });
}
