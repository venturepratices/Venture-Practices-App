import { NextResponse } from "next/server";

import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { parseTrackingLabelInput, setTrackingLabel } from "@/lib/calls/tracking-labels";

export const runtime = "nodejs";

/**
 * Name (or un-name) a tracking number, for example "Direct Mail".
 * Body: { number: "+17043973212", label: "Direct Mail" }. An empty label
 * removes the name. Needs the same permission as connecting HighLevel, and
 * only reaches clients the signed-in person is allowed to see.
 */
export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireCapability("canManageHighLevel");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = parseTrackingLabelInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await setTrackingLabel({ actor, number: parsed.number, label: parsed.label });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, clients: result.clients, removed: result.removed });
}
