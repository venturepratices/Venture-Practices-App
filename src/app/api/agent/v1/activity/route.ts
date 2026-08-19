import { NextResponse } from "next/server";

import { requireAgentToken } from "@/lib/agent-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Actions/entities never surfaced to an external agent, even though they
 * live in the same ActivityLog table as everything else: credential-vault
 * events (logged under the generic "Client" entityType, so filtered by
 * action prefix, not entityType), HighLevel connect/disconnect metadata, and
 * ClientOrder rows (real client billing/fees — kept opt-in inside the app
 * itself via canViewOrders/canManageOrders, so an external AI gets the same
 * treatment by default).
 */
const EXCLUDED_ACTION_PREFIXES = ["credential_", "highlevel_"];
const EXCLUDED_ENTITY_TYPES = ["ClientOrder"];

/**
 * GET /api/agent/v1/activity — the most recent things that happened in the
 * app, optionally scoped to one client. Answers "what's new," "what
 * happened recently," "any updates on X" — the gap that sent an agent
 * (Viktor) into a 45-second timeout before this endpoint existed, since it
 * had no way to answer that class of question at all.
 */
export async function GET(request: Request) {
  const unauthorized = requireAgentToken(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 50);

  const entries = await prisma.activityLog.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      entityType: { notIn: EXCLUDED_ENTITY_TYPES },
      AND: EXCLUDED_ACTION_PREFIXES.map((prefix) => ({ NOT: { action: { startsWith: prefix } } })),
    },
    select: {
      actorName: true,
      entityType: true,
      entityLabel: true,
      action: true,
      description: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ activity: entries });
}
