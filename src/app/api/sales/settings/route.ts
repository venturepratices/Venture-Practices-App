import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SALES_MEMBER_WHERE } from "@/lib/sales/access";
import { auditDiff, recordSalesAudit } from "@/lib/sales/audit";
import { adminActor } from "@/lib/sales/bot-admin";

// The rotation cursor is deliberately not part of this: it moves only when a lead
// is assigned (see lead-assignment.ts), never from here, and never in the history log.
const SETTINGS_SELECT = { leadAssignMode: true, roundRobinMemberIds: true, singleAssigneeId: true } as const;

const DEFAULT_SETTINGS = { leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: [], singleAssigneeId: null } as const;

const updateSettingsSchema = z
  .object({
    leadAssignMode: z.enum(["ROUND_ROBIN", "SINGLE"]).optional(),
    roundRobinMemberIds: z
      .array(z.string().min(1))
      .max(100)
      .transform((ids) => [...new Set(ids)])
      .optional(),
    singleAssigneeId: z.string().min(1).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: "Nothing to change." });

/** Admin: how new leads get an owner. */
export async function GET() {
  try {
    await requireAdmin();
    const settings = await prisma.salesSettings.findUnique({ where: { id: "singleton" }, select: SETTINGS_SELECT });
    return NextResponse.json({ settings: settings ?? DEFAULT_SETTINGS });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Admin: change the mode, the rotation list or the single person. Every change is logged. */
export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = updateSettingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const { leadAssignMode, roundRobinMemberIds, singleAssigneeId } = parsed.data;

    // Everyone named must be an admin or have the Sales switch.
    const named = [...(roundRobinMemberIds ?? []), ...(singleAssigneeId ? [singleAssigneeId] : [])];
    if (named.length > 0) {
      const found = await prisma.teamMember.findMany({
        where: { id: { in: [...new Set(named)] }, ...SALES_MEMBER_WHERE },
        select: { id: true },
      });
      const allowed = new Set(found.map((person) => person.id));
      if (named.some((id) => !allowed.has(id))) {
        return NextResponse.json({ error: "Choose team members with Sales access." }, { status: 400 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const before = (await tx.salesSettings.findUnique({ where: { id: "singleton" }, select: SETTINGS_SELECT })) ?? DEFAULT_SETTINGS;

      const finalMode = leadAssignMode ?? before.leadAssignMode;
      const finalPerson = singleAssigneeId === undefined ? before.singleAssigneeId : singleAssigneeId;
      if (finalMode === "SINGLE" && !finalPerson) return { error: "Choose the person who gets every new lead." };

      const changes = { leadAssignMode, roundRobinMemberIds, singleAssigneeId };
      const after = await tx.salesSettings.upsert({
        where: { id: "singleton" },
        // A new row always gets a real list (never NULL), even when this save leaves it out.
        create: { id: "singleton", ...changes, roundRobinMemberIds: roundRobinMemberIds ?? [] },
        update: changes,
        select: SETTINGS_SELECT,
      });

      const diff = auditDiff(before, after);
      if (Object.keys(diff.after).length > 0) {
        await recordSalesAudit(tx, adminActor(admin), {
          entityType: "SalesSettings",
          entityId: "singleton",
          action: "updated",
          ...diff,
        });
      }
      return { settings: after };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ settings: result.settings });
  } catch (error) {
    return toErrorResponse(error);
  }
}
