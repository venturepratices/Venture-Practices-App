import { requireMarketingPage } from "@/lib/marketing/page-gate";
import { getAllInsights, type InsightsWindow } from "@/lib/marketing/insights";
import { SEQUENCES } from "@/lib/marketing/sequences";
import { StatsView } from "@/components/marketing/stats-view";

// Marketing > Stats. One screen with every sequence's health, open/click/reply
// rates, and a per-email breakdown. Right now the numbers come from a
// hand-maintained snapshot (see insights.ts) because every flow is in Draft.
// A later PR swaps `getAllInsights` for a server-side NitroSend HTTP client
// once the API key lands in Vercel env.
export const dynamic = "force-dynamic";

const VALID_WINDOWS: readonly InsightsWindow[] = ["7d", "30d", "all"];

function parseWindow(value: string | string[] | undefined): InsightsWindow {
  if (typeof value === "string" && (VALID_WINDOWS as readonly string[]).includes(value)) {
    return value as InsightsWindow;
  }
  return "30d";
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string | string[] }>;
}) {
  await requireMarketingPage();
  const params = await searchParams;
  const window = parseWindow(params.window);
  const insightsByKey = await getAllInsights(window);
  return <StatsView sequences={SEQUENCES} insightsByKey={insightsByKey} window={window} />;
}
