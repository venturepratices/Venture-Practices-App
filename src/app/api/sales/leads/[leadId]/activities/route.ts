import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { createActivitySchema, createLeadActivity } from "@/lib/sales/activities";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";

type Context = { params: Promise<{ leadId: string }> };

/** Schedule an activity on an open lead (`{ type, subject, dueDate, dueTime }`). Answers 201 `{ activity }`. */
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { leadId } = await params;

    const body = await readJson(request, createActivitySchema);
    if (!body.ok) return failResponse(body);

    const result = await createLeadActivity(actor, leadId, body.data, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ activity: result.activity }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
