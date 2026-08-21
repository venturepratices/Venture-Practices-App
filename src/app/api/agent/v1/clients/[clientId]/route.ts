import { NextResponse } from "next/server";

import { requireAgentToken } from "@/lib/agent-auth";
import { getClientDetail } from "@/lib/agent-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/v1/clients/[clientId] — one client's full working picture:
 * info, open/overdue tasks, active projects (with current stage), direct
 * mail campaigns, assets waiting on a decision, and recent notes. This is
 * the endpoint an agent (Viktor) calls after /api/agent/v1/clients to answer
 * "what's going on with X."
 *
 * Deliberately excludes: the credentials vault, private tasks, and
 * HighLevel conversations/calls — see src/lib/agent-data.ts for the shared
 * exclusion rules this and every other agent-facing endpoint follow.
 */
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const unauthorized = requireAgentToken(request);
  if (unauthorized) return unauthorized;

  const { clientId } = await params;
  const detail = await getClientDetail(clientId);
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
