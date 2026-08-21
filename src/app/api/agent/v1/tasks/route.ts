import { NextResponse } from "next/server";

import { requireAgentToken } from "@/lib/agent-auth";
import { listTasks } from "@/lib/agent-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/v1/tasks — cross-client task list, for questions
 * /api/agent/v1/clients/[clientId] can't answer because they're not scoped
 * to one client ("what are my tasks," "what's overdue across everything,"
 * "what is <name> working on"). Always excludes private tasks, regardless
 * of who's asking — see src/lib/agent-data.ts.
 *
 * Query params (all optional): clientId, assigneeName (case-insensitive
 * contains match), overdue=true, includeComplete=true.
 */
export async function GET(request: Request) {
  const unauthorized = requireAgentToken(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const tasks = await listTasks({
    clientId: url.searchParams.get("clientId") ?? undefined,
    assigneeName: url.searchParams.get("assigneeName") ?? undefined,
    overdueOnly: url.searchParams.get("overdue") === "true",
    includeComplete: url.searchParams.get("includeComplete") === "true",
  });

  return NextResponse.json({ tasks });
}
