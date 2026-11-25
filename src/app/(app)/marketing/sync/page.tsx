import { requireMarketingPage } from "@/lib/marketing/page-gate";
import { logMarketingView } from "@/lib/marketing/audit";
import { SEQUENCES } from "@/lib/marketing/sequences";
import { buildSnapshotRows, summarize } from "@/lib/marketing/sync";
import { SyncView } from "@/components/marketing/sync-view";

/**
 * Marketing > Sync. Shows how each sequence is wired across NitroSend and
 * HighLevel. Read-only: no writes to either system, no writes to our DB
 * (other than the audit log entry that records the view itself).
 *
 * Today the connection values come from the hand-maintained SEQUENCES
 * snapshot. A later PR swaps `buildSnapshotRows` for a parallel live fetch
 * (NitroSend HTTP + GHL MCP) that compares against the snapshot and promotes
 * any mismatches. The view layer does not change.
 */
export const dynamic = "force-dynamic";

export default async function MarketingSyncPage() {
  const actor = await requireMarketingPage();

  // Fire-and-forget view audit. `logMarketingView` catches its own errors so a
  // logging outage never breaks the page.
  void logMarketingView(actor, "marketing.sync.view", {
    sequenceCount: Object.keys(SEQUENCES).length,
  });

  const rows = buildSnapshotRows(SEQUENCES);
  const summary = summarize(rows);
  // Human-friendly, locale-stable: "Nov 25, 2026". Reads better than ISO on the
  // narrow mobile header where the label sits next to the page title.
  const snapshotTimestamp = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <SyncView rows={rows} summary={summary} snapshotTimestamp={snapshotTimestamp} />
  );
}
