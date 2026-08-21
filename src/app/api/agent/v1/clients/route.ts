import { NextResponse } from "next/server";

import { requireAgentToken } from "@/lib/agent-auth";
import { listClients } from "@/lib/agent-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/v1/clients — every client with a quick status snapshot.
 * The overview list an agent (Viktor) reads before drilling into one client
 * via /api/agent/v1/clients/[clientId]. Read-only, no write counterpart
 * exists anywhere under /api/agent.
 */
export async function GET(request: Request) {
  const unauthorized = requireAgentToken(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ clients: await listClients() });
}
