import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { LEADERSHIP_MEMBER_WHERE } from "@/lib/leadership";
import { notifyChannel } from "@/lib/notify";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { mentionOrName } from "@/lib/slack";
import { endOfDay, formatDate } from "@/lib/utils";
import { updateRockSchema } from "@/lib/validations/leadership";

type Params = { params: Promise<{ rockId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  try {
    await requireCapability("canUseLeadership");
  } catch (error) {
    return toErrorResponse(error);
  }
  const { rockId } = await params;
  const rock = await prisma.rock.findFirst({ where: { id: rockId, archivedAt: null } });
  if (!rock) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = updateRockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { dueDate, ownerId, status, ...rest } = parsed.data;

  if (ownerId) {
    const owner = await prisma.teamMember.findFirst({ where: { id: ownerId, ...LEADERSHIP_MEMBER_WHERE }, select: { id: true } });
    if (!owner) return NextResponse.json({ error: "Rock owners need access to Issues & Rocks." }, { status: 400 });
  }

  const updated = await prisma.rock.update({
    where: { id: rockId },
    data: {
      ...rest,
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...(dueDate ? { dueDate: endOfDay(dueDate) } : {}),
      // statusUpdatedAt is the weekly check-in timestamp — re-picking the
      // same status still counts as "I looked at this this week".
      ...(status ? { status, statusUpdatedAt: new Date() } : {}),
    },
    include: { owner: { select: { id: true, name: true, email: true, slackUserId: true } } },
  });

  // Off-track alert: one post to the general team channel (Rocks have no
  // client), only on the transition INTO off track — not every re-save.
  if (status === "OFF_TRACK" && rock.status !== "OFF_TRACK") {
    const ownerLabel = updated.owner ? await mentionOrName(updated.owner, updated.owner.name) : "No owner";
    await notifyChannel({
      title: `Rock off track: "${updated.title}"`,
      lines: [`Owner: ${ownerLabel}`, `Marked by ${session?.user?.name ?? "someone"}`, `Due ${formatDate(updated.dueDate)}`],
      linkPath: "/rocks",
      buttonLabel: "Open Rocks",
    });
  }

  return NextResponse.json(updated);
}

// "Remove" — archived, not hard-deleted (ARCHITECTURE.md's soft-delete rule).
export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireCapability("canUseLeadership");
  } catch (error) {
    return toErrorResponse(error);
  }
  const { rockId } = await params;
  const rock = await prisma.rock.findFirst({ where: { id: rockId, archivedAt: null }, select: { id: true } });
  if (!rock) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.rock.update({ where: { id: rockId }, data: { archivedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
