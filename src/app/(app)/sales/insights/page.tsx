import { loadInsights } from "@/lib/sales/insights";
import { parseInsightsQuery } from "@/lib/sales/insights-query";
import { requireSalesPage } from "@/lib/sales/page-gate";
import { InsightsView } from "@/components/sales/insights-view";

// Sales Insights (Decision 27): the pipeline funnel, deals won over time,
// average deal cycle time, and activities completed per person. Every chart
// reads one range and one scope (Everyone or Just me) through the shared
// parser; the funnel also reads its pipeline. Gated here as well as in the
// Sales layout (layouts do not re-run on navigation). The data and the screen
// read the same clock, so the "so far" marker on this month, day colours and
// month names all agree.
export default async function SalesInsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSalesPage();
  const query = parseInsightsQuery(await searchParams);
  const now = new Date();
  const data = await loadInsights(actor, query, now);

  return <InsightsView data={data} now={now.toISOString()} />;
}
