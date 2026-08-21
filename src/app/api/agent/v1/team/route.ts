import { NextResponse } from "next/server";

import { requireAgentToken } from "@/lib/agent-auth";
import { listTeam } from "@/lib/agent-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/v1/team — the team roster (name, email, admin flag). Lets
 * an agent (Viktor) resolve "who's on the team" or match a name mentioned in
 * a question to a real person. Deliberately excludes every permission
 * flag/capability column — internal implementation detail, not something a
 * question about "who does what" needs.
 */
export async function GET(request: Request) {
  const unauthorized = requireAgentToken(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ team: await listTeam() });
}
