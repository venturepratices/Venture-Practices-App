import { NextResponse } from "next/server";

import { requireAgentToken } from "@/lib/agent-auth";
import { listActivity } from "@/lib/agent-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/v1/activity — the most recent things that happened in the
 * app, optionally scoped to one client. Answers "what's new," "what
 * happened recently," "any updates on X." Excludes credential-vault
 * activity, HighLevel connection events, and client billing/order changes —
 * see src/lib/agent-data.ts for the shared exclusion rules.
 */
export async function GET(request: Request) {
  const unauthorized = requireAgentToken(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const activity = await listActivity({
    clientId: url.searchParams.get("clientId") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });

  return NextResponse.json({ activity });
}
