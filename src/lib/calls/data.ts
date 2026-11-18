import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { getCallsStatsForWindow, type CallsWindowStats } from "@/lib/highlevel-calls";
import { CALLS_PAGE_SIZE, type CallsQuery } from "@/lib/calls/query";

export type CallsCallerType = "first-time" | "repeat";
export type CallsStatusGroup = "answered" | "missed" | "other";

export type CallsListRow = {
  id: string;
  clientId: string;
  clientName: string;
  contactName: string | null;
  callerPhone: string | null;
  trackingNumber: string | null;
  trackingLabel: string | null;
  direction: string | null;
  status: string | null;
  statusGroup: CallsStatusGroup;
  lastCallAt: Date | null;
  callerType: CallsCallerType;
};

export type CallsPageData = {
  stats: CallsWindowStats;
  rows: CallsListRow[];
  totalRows: number;
  page: number;
  pageSize: number;
  clientOptions: Array<{ id: string; name: string }>;
  trackingOptions: Array<{ number: string; label: string }>;
  start: Date;
  end: Date;
  lastSyncedAt: Date | null;
};

type Actor = { userId: string; isAdmin: boolean; allClientsAccess: boolean };

/** The Prisma where clause that narrows a query to the clients a caller can read. */
async function allowedClientIds(actor: Actor): Promise<string[] | null> {
  if (actor.isAdmin || actor.allClientsAccess) return null;
  const rows = await prisma.clientAccess.findMany({
    where: { teamMemberId: actor.userId },
    select: { clientId: true },
  });
  return rows.map((r) => r.clientId);
}

function statusWhere(status: CallsQuery["status"], start: Date, end: Date): Prisma.HighLevelCallSummaryWhereInput {
  switch (status) {
    case "answered":
      return { status: "completed" };
    case "missed":
      return { status: { in: ["no-answer", "busy", "failed"] } };
    case "first":
      return { firstSeenAt: { gte: start, lt: end } };
    case "repeat":
      return { firstSeenAt: { lt: start } };
    default:
      return {};
  }
}

function groupStatus(raw: string | null): CallsStatusGroup {
  const s = (raw ?? "").toLowerCase();
  if (s === "completed") return "answered";
  if (s === "no-answer" || s === "busy" || s === "failed") return "missed";
  return "other";
}

/** Build the Prisma where clause once, so page rows + CSV export see the same set. */
function buildWhere(args: {
  effectiveClientIds: string[] | null;
  start: Date;
  end: Date;
  trackingNumber: string | null;
  status: CallsQuery["status"];
}): Prisma.HighLevelCallSummaryWhereInput {
  const where: Prisma.HighLevelCallSummaryWhereInput = {
    lastCallAt: { gte: args.start, lt: args.end },
    ...statusWhere(args.status, args.start, args.end),
  };
  if (args.effectiveClientIds !== null) where.clientId = { in: args.effectiveClientIds };
  if (args.trackingNumber) where.trackingNumber = args.trackingNumber;
  return where;
}

/**
 * Resolve the caller's visible clientIds given the filter.
 * Returns null when the caller is an admin AND no client filter is set
 * (i.e. all clients). Returns an array otherwise, possibly empty.
 */
async function resolveClientIds(
  actor: Actor,
  filterClientId: string | null,
): Promise<string[] | null> {
  const allowed = await allowedClientIds(actor);
  if (filterClientId) {
    if (allowed === null) return [filterClientId];
    return allowed.includes(filterClientId) ? [filterClientId] : [];
  }
  return allowed;
}

/**
 * Load everything the Calls page needs: stats + current page of rows +
 * filter options + a "last synced" marker. One function so all queries
 * fire in parallel and the page renders in a single server roundtrip.
 */
export async function loadCallsPageData(args: {
  actor: Actor;
  query: CallsQuery;
  start: Date;
  end: Date;
  pageSize?: number;
}): Promise<CallsPageData> {
  const pageSize = args.pageSize ?? CALLS_PAGE_SIZE;
  const effectiveClientIds = await resolveClientIds(args.actor, args.query.clientId);
  const where = buildWhere({
    effectiveClientIds,
    start: args.start,
    end: args.end,
    trackingNumber: args.query.trackingNumber,
    status: args.query.status,
  });

  // Client + tracking filter options are scoped to what the caller can read,
  // NOT to what the current window has — so a user with calls in January
  // doesn't lose their client from the dropdown when they switch to a 7d view
  // that has none.
  const optionsClientFilter: Prisma.ClientWhereInput | undefined =
    effectiveClientIds !== null ? { id: { in: effectiveClientIds } } : undefined;
  const optionsTrackingFilter: Prisma.HighLevelTrackingNumberWhereInput | undefined =
    effectiveClientIds !== null ? { clientId: { in: effectiveClientIds } } : undefined;

  const [callRows, totalRows, clientOptions, trackingOptions, lastSyncedAt, stats] = await Promise.all([
    prisma.highLevelCallSummary.findMany({
      where,
      include: { client: { select: { id: true, name: true } } },
      orderBy: { lastCallAt: "desc" },
      skip: Math.max(0, (args.query.page - 1) * pageSize),
      take: pageSize,
    }),
    prisma.highLevelCallSummary.count({ where }),
    prisma.client.findMany({
      where: optionsClientFilter,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.highLevelTrackingNumber.findMany({
      where: optionsTrackingFilter,
      select: { number: true, label: true },
      orderBy: { label: "asc" },
    }),
    prisma.highLevelCallSummary.findFirst({
      where: effectiveClientIds !== null ? { clientId: { in: effectiveClientIds } } : {},
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
    getCallsStatsForWindow({
      clientIds: effectiveClientIds ?? undefined,
      start: args.start,
      end: args.end,
    }),
  ]);

  // Attach tracking labels per (clientId, number). A number without a label
  // keeps its raw number in the view; we never fall back to a different
  // client's label for the same number.
  const labelMap = new Map<string, string>();
  const trackingForLabels = await prisma.highLevelTrackingNumber.findMany({
    where: optionsTrackingFilter,
    select: { clientId: true, number: true, label: true },
  });
  for (const t of trackingForLabels) labelMap.set(`${t.clientId}:${t.number}`, t.label);

  const rows: CallsListRow[] = callRows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.client.name,
    contactName: r.contactName,
    callerPhone: r.callerPhone,
    trackingNumber: r.trackingNumber,
    trackingLabel: r.trackingNumber ? labelMap.get(`${r.clientId}:${r.trackingNumber}`) ?? null : null,
    direction: r.direction,
    status: r.status,
    statusGroup: groupStatus(r.status),
    lastCallAt: r.lastCallAt,
    callerType: r.firstSeenAt >= args.start && r.firstSeenAt < args.end ? "first-time" : "repeat",
  }));

  return {
    stats,
    rows,
    totalRows,
    page: args.query.page,
    pageSize,
    clientOptions,
    trackingOptions: trackingOptions.map((t) => ({ number: t.number, label: t.label })),
    start: args.start,
    end: args.end,
    lastSyncedAt: lastSyncedAt?.lastSyncedAt ?? null,
  };
}

/**
 * Same filters as the page, but returns EVERY matching row for the CSV export.
 * Capped to 5000 rows to keep the response size bounded; above that the
 * export is best run narrower (client filter + shorter range).
 */
export async function loadCallsForExport(args: {
  actor: Actor;
  query: CallsQuery;
  start: Date;
  end: Date;
}): Promise<CallsListRow[]> {
  const effectiveClientIds = await resolveClientIds(args.actor, args.query.clientId);
  const where = buildWhere({
    effectiveClientIds,
    start: args.start,
    end: args.end,
    trackingNumber: args.query.trackingNumber,
    status: args.query.status,
  });
  const optionsTrackingFilter: Prisma.HighLevelTrackingNumberWhereInput | undefined =
    effectiveClientIds !== null ? { clientId: { in: effectiveClientIds } } : undefined;

  const [callRows, trackingForLabels] = await Promise.all([
    prisma.highLevelCallSummary.findMany({
      where,
      include: { client: { select: { id: true, name: true } } },
      orderBy: { lastCallAt: "desc" },
      take: 5000,
    }),
    prisma.highLevelTrackingNumber.findMany({
      where: optionsTrackingFilter,
      select: { clientId: true, number: true, label: true },
    }),
  ]);

  const labelMap = new Map<string, string>();
  for (const t of trackingForLabels) labelMap.set(`${t.clientId}:${t.number}`, t.label);

  return callRows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.client.name,
    contactName: r.contactName,
    callerPhone: r.callerPhone,
    trackingNumber: r.trackingNumber,
    trackingLabel: r.trackingNumber ? labelMap.get(`${r.clientId}:${r.trackingNumber}`) ?? null : null,
    direction: r.direction,
    status: r.status,
    statusGroup: groupStatus(r.status),
    lastCallAt: r.lastCallAt,
    callerType: r.firstSeenAt >= args.start && r.firstSeenAt < args.end ? "first-time" : "repeat",
  }));
}
