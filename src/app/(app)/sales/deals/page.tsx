import { SquareKanban } from "lucide-react";

import { loadBoardPage } from "@/lib/sales/board";
import { parseBoardQuery } from "@/lib/sales/board-query";
import { requireSalesPage } from "@/lib/sales/page-gate";
import { loadDefaultView } from "@/lib/sales/view-preference";
import { EmptyState } from "@/components/ui/empty-state";
import { DealsView } from "@/components/sales/deals-view";

// The Deals board and list. Gated here as well as in the Sales layout (layouts
// do not re-run on navigation). The remembered view (pipeline, Board or List,
// Everyone or Just me) applies only when the URL names none of the three, so a
// toolbar click, which always names the pipeline, is never undone by it.
export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSalesPage();
  const params = await searchParams;

  const bare = params.pipeline === undefined && params.view === undefined && params.scope === undefined;
  const saved = bare ? await loadDefaultView(actor.userId) : undefined;
  const query = parseBoardQuery(params, saved);
  const now = new Date();
  const data = await loadBoardPage(actor, query, now);

  if (!data) {
    return (
      <EmptyState
        icon={SquareKanban}
        title="No pipelines yet"
        description="Sales needs its pipelines before deals can be added. Ask an admin to run the Sales setup."
      />
    );
  }

  return (
    <DealsView
      data={data}
      viewer={{ userId: actor.userId, isAdmin: actor.isAdmin }}
      openNew={params.new === "1"}
      now={now.toISOString()}
    />
  );
}
