import { NextResponse } from "next/server";
import { z } from "zod";

import { logActivity } from "@/lib/activity-log";
import { ANNOTATION_COLORS, PATH_TYPES, TWO_POINT_TYPES } from "@/lib/asset-annotation";
import { notifyAssetCommented } from "@/lib/asset-notify";
import { resolveAssetActor, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * Create a comment on a specific asset version. Supports:
 *  - a markup annotation (pin/rectangle/ellipse/arrow/pencil/highlighter) for
 *    IMAGE / WEBSITE / a paused VIDEO frame — see src/lib/asset-annotation.ts
 *  - a video timecode (timecodeMs) for VIDEO, paired with an annotation when
 *    a shape was drawn on that paused frame
 *  - a page number (page, 1-indexed) for PDF (general comments only — PDF
 *    doesn't support drawn markup, see the AssetComment schema comment)
 *  - a threaded reply (parentId)
 * All of those are optional — a bare body is a general comment.
 *
 * Accepts either a TeamMember session (gated by canCommentOnAssets) or a
 * ClientUser session (gated by "their own client, non-draft asset") — see
 * resolveAssetActor. Every comment must be attributed to an AssetReviewer
 * row; whichever kind of actor this is, they're lazily made a reviewer of
 * the asset on first comment (findFirst-or-create) so commenting works
 * without first going through the Slice 3 reviewer-assignment UI.
 */
const annotationPointSchema = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) });

const annotationSchema = z
  .object({
    type: z.enum(["pin", "rectangle", "ellipse", "arrow", "pencil", "highlighter"]),
    color: z.string().refine((c) => ANNOTATION_COLORS.some((preset) => preset.value === c), "Unknown color"),
    points: z.array(annotationPointSchema).min(1).max(500),
  })
  .refine(
    (a) => (a.type === "pin" ? a.points.length === 1 : TWO_POINT_TYPES.includes(a.type) ? a.points.length === 2 : PATH_TYPES.includes(a.type) ? a.points.length >= 2 : true),
    "Wrong number of points for annotation type"
  );

const createCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment can't be empty").max(4000),
  annotation: annotationSchema.optional(),
  timecodeMs: z.number().int().nonnegative().optional(),
  page: z.number().int().positive().optional(),
  parentId: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string; versionId: string }> }
) {
  const { assetId, versionId } = await params;

  // Resolve the asset (for its clientId/status) and confirm the version belongs to it.
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { id: true, title: true, clientId: true, status: true, createdById: true, versions: { select: { id: true } } },
  });
  if (!asset || !asset.versions.some((v) => v.id === versionId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let actor;
  try {
    actor = await resolveAssetActor(asset, "canCommentOnAssets");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  // If replying, the parent must live on the same version.
  if (parsed.data.parentId) {
    const parent = await prisma.assetComment.findUnique({
      where: { id: parsed.data.parentId },
      select: { versionId: true },
    });
    if (!parent || parent.versionId !== versionId) {
      return NextResponse.json({ error: "Invalid parent comment" }, { status: 400 });
    }
  }

  // Lazily ensure this actor (team member or client user) has a reviewer row on the asset.
  let reviewer = await prisma.assetReviewer.findFirst({
    where: { assetId, ...actor.reviewerWhere },
    select: { id: true },
  });
  if (!reviewer) {
    reviewer = await prisma.assetReviewer.create({
      data: { assetId, ...actor.reviewerWhere },
      select: { id: true },
    });
  }

  const comment = await prisma.assetComment.create({
    data: {
      versionId,
      reviewerId: reviewer.id,
      body: parsed.data.body,
      annotation: parsed.data.annotation ?? undefined,
      timecodeMs: parsed.data.timecodeMs ?? null,
      page: parsed.data.page ?? null,
      parentId: parsed.data.parentId ?? null,
    },
    include: {
      reviewer: { select: { teamMember: { select: { name: true } }, clientUser: { select: { name: true } }, guestName: true } },
    },
  });

  await logActivity({
    actorId: actor.actorId,
    actorName: actor.actorName,
    entityType: "Asset",
    entityId: assetId,
    entityLabel: asset.title,
    action: "asset_commented",
    description: `${actor.actorName ?? "Someone"} commented on asset "${asset.title}"`,
  });
  await notifyAssetCommented({
    assetId,
    assetTitle: asset.title,
    ownerId: asset.createdById,
    commenterTeamMemberId: actor.actorId,
    commenterName: actor.actorName,
  });

  return NextResponse.json(comment, { status: 201 });
}
