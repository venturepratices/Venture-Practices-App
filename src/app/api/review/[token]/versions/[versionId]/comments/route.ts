import { NextResponse } from "next/server";
import { z } from "zod";

import { logActivity } from "@/lib/activity-log";
import { ANNOTATION_COLORS, PATH_TYPES, TWO_POINT_TYPES } from "@/lib/asset-annotation";
import { notifyAssetCommented } from "@/lib/asset-notify";
import { resolveShareLinkAccess } from "@/lib/share-link";
import { prisma } from "@/lib/prisma";

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

/**
 * Guest equivalent of /api/assets/[assetId]/versions/[versionId]/comments.
 * Everything is derived from the share-link token, never from the URL's
 * versionId alone — the version is confirmed to belong to the token's own
 * asset before anything is written, so a guest can never comment onto a
 * version outside the one asset they were given a link for.
 */
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

  const version = await prisma.assetVersion.findFirst({ where: { id: versionId, assetId: access.link.assetId } });
  if (!version) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  if (parsed.data.parentId) {
    const parent = await prisma.assetComment.findUnique({ where: { id: parsed.data.parentId }, select: { versionId: true } });
    if (!parent || parent.versionId !== versionId) {
      return NextResponse.json({ error: "Invalid parent comment" }, { status: 400 });
    }
  }

  const reviewer = await prisma.assetReviewer.findFirst({
    where: { id: access.cookiePayload.guestReviewerId, assetId: access.link.assetId },
  });
  if (!reviewer) {
    return NextResponse.json({ error: "Please enter your name and email first." }, { status: 403 });
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
  });

  const asset = await prisma.asset.findUnique({ where: { id: access.link.assetId }, select: { title: true, createdById: true } });
  await logActivity({
    actorId: null,
    actorName: reviewer.guestName ?? "A guest reviewer",
    entityType: "Asset",
    entityId: access.link.assetId,
    entityLabel: asset?.title ?? "Asset",
    action: "asset_commented",
    description: `${reviewer.guestName ?? "A guest"} commented on asset "${asset?.title ?? ""}" via a share link`,
  });
  await notifyAssetCommented({
    assetId: access.link.assetId,
    assetTitle: asset?.title ?? "Asset",
    ownerId: asset?.createdById ?? null,
    commenterTeamMemberId: null,
    commenterName: reviewer.guestName ?? "A guest reviewer",
  });

  return NextResponse.json(comment, { status: 201 });
}
