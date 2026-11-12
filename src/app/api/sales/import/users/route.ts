import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SALES_MEMBER_WHERE } from "@/lib/sales/access";
import { fail, failResponse, readJson } from "@/lib/sales/http";
import { loadUserMappings, setUserMapping } from "@/lib/sales/pipedrive/import";

const userMapSchema = z.strictObject({
  pipedriveUserId: z.number().int().positive(),
  memberId: z.string().min(1).max(100),
});

/**
 * Admin: which team member a Pipedrive user's records go to on the next copy.
 * The member must be able to own Sales records. Answers `{ users }`, the owner
 * list as it now stands.
 */
export async function PUT(request: Request) {
  try {
    await requireAdmin();
    const body = await readJson(request, userMapSchema);
    if (!body.ok) return failResponse(body);

    const member = await prisma.teamMember.findFirst({
      where: { id: body.data.memberId, ...SALES_MEMBER_WHERE },
      select: { id: true },
    });
    if (!member) return failResponse(fail(400, "That team member cannot own Sales records."));

    await setUserMapping({ pipedriveUserId: body.data.pipedriveUserId, memberId: body.data.memberId });
    return NextResponse.json({ users: await loadUserMappings() });
  } catch (error) {
    return toErrorResponse(error);
  }
}
