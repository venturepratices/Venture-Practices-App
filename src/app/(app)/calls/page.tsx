import { notFound } from "next/navigation";

import { canUseCapability, requireUser } from "@/lib/permissions";
import { parseCallsQuery, rangeWindow } from "@/lib/calls/query";
import { loadCallsPageData } from "@/lib/calls/data";
import { CallsView } from "@/components/calls/calls-view";

/**
 * The global Calls view. Pulls from `HighLevelCallSummary` (HL is synced into
 * the app so Muse can read past the HIPAA wall HighLevel puts on client
 * sub-accounts' call records). One screen, one range, one client filter;
 * paged rows, a tracking-number breakdown, and a CSV export that reuses the
 * same filter parser.
 *
 * Gate: `canViewConversations` (same capability the per-client Calls tab uses,
 * since this is the same kind of data at a higher level).
 */
export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await canUseCapability("canViewConversations"))) notFound();
  const actor = await requireUser();
  const query = parseCallsQuery(await searchParams);
  const now = new Date();
  const { start, end } = rangeWindow(query.range, now);
  const data = await loadCallsPageData({ actor, query, start, end });

  return <CallsView data={data} query={query} now={now.toISOString()} />;
}
