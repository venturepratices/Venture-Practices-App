import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { ANNOTATION_COLORS, PATH_TYPES, TWO_POINT_TYPES } from "@/lib/asset-annotation";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
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
 * Every comment must be attributed to an AssetReviewer row. An agency team
 * member who comments is lazily made a reviewer of the asset (findFirst-or-
 * create) so commenting works without first going through the Slice 3 reviewer-
 * assignment UI.
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
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId, versionId } = await params;

  // Resolve the asset (for its clientId) and confirm the version belongs to it.
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { id: true, title: true, clientId: true, versions: { select: { id: true } } },
  });
  if (!asset || !asset.versions.some((v) => v.id === versionId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(asset.clientId);
    await requireCapability("canCommentOnAssets");
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

  // Lazily ensure this team member has a reviewer row on the asset.
  let reviewer = await prisma.assetReviewer.findFirst({
    where: { assetId, teamMemberId: session.user.id },
    select: { id: true },
  });
  if (!reviewer) {
    reviewer = await prisma.assetReviewer.create({
      data: { assetId, teamMemberId: session.user.id },
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
      reviewer: { select: { teamMember: { select: { name: true } }, guestName: true } },
    },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Asset",
    entityId: assetId,
    entityLabel: asset.title,
    action: "asset_commented",
    description: `${session.user.name ?? "Someone"} commented on asset "${asset.title}"`,
  });

  return NextResponse.json(comment, { status: 201 });
}
