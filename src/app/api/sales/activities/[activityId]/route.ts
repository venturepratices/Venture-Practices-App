import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { activityDoneSchema, setActivityDone } from "@/lib/sales/activities";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";

type Context = { params: Promise<{ activityId: string }> };

/**
 * Tick an activity done (`{ done: true }`) or open it again (`{ done: false }`).
 * Answers with the change and the deal's open activity count, which tells the
 * screen whether to ask for the next step.
 */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { activityId } = await params;

    const body = await readJson(request, activityDoneSchema);
    if (!body.ok) return failResponse(body);

    const result = await setActivityDone(actor, activityId, body.data.done, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
