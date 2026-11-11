import { loadActivitiesPage } from "@/lib/sales/activities-page";
import { parseActivitiesQuery } from "@/lib/sales/activities-query";
import { requireSalesPage } from "@/lib/sales/page-gate";
import { ActivitiesView } from "@/components/sales/activities-view";

// The Activities page: calls, meetings and tasks on the deals this person may
// see, filtered by the URL (to do, overdue, today or done; a type; Everyone or
// Just me). Gated here as well as in the Sales layout (layouts do not re-run on
// navigation). It always shows the first page; "Show more" fetches the rest.
export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSalesPage();
  const query = parseActivitiesQuery(await searchParams);
  const now = new Date();
  const data = await loadActivitiesPage(actor, query, now);

  return (
    <ActivitiesView data={data} viewer={{ userId: actor.userId, isAdmin: actor.isAdmin }} now={now.toISOString()} />
  );
}
