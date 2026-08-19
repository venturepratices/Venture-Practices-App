import { NextResponse } from "next/server";

import { requireAgentToken } from "@/lib/agent-auth";
import { prisma } from "@/lib/prisma";

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

  const team = await prisma.teamMember.findMany({
    select: { name: true, email: true, isAdmin: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ team });
}
