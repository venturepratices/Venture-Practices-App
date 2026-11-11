import { loadLeadsPage } from "@/lib/sales/leads-page";
import { parseLeadsQuery } from "@/lib/sales/leads-query";
import { requireSalesPage } from "@/lib/sales/page-gate";
import { LeadsView } from "@/components/sales/leads-view";

// The Leads Inbox (Decision 11): open leads, newest first, for Everyone or Just
// me and a search, read from the URL. Gated here as well as in the Sales
// layout (layouts do not re-run on navigation). It always shows the first
// page; "Show more" fetches the rest. `?new=1` opens Add lead straight away.
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSalesPage();
  const params = await searchParams;
  const query = parseLeadsQuery(params);
  const data = await loadLeadsPage(actor, query);

  return (
    <LeadsView
      data={data}
      viewer={{ userId: actor.userId, isAdmin: actor.isAdmin }}
      openNew={params.new === "1"}
      now={new Date().toISOString()}
    />
  );
}
