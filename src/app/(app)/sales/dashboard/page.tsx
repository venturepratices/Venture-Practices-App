import { loadDashboard, parseDashboardScope } from "@/lib/sales/dashboard";
import { requireSalesPage } from "@/lib/sales/page-gate";
import { DashboardView } from "@/components/sales/dashboard-view";

// The Sales dashboard (Decisions 25 and 26): the KPI tiles, the "Expected to
// close" forecast and the four boxes of work, for Everyone or Just me
// (`?scope=mine`). Gated here as well as in the Sales layout (layouts do not
// re-run on navigation). The data and the screen read the same clock, so the
// day colours match what the server counted.
export default async function SalesDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSalesPage();
  const scope = parseDashboardScope(await searchParams);
  const now = new Date();
  const data = await loadDashboard(actor, scope, now);

  return <DashboardView data={data} now={now.toISOString()} />;
}
