import { SequenceMapView } from "@/components/marketing/sequence-map-view";
import { DEFAULT_SEQUENCE_KEY, SEQUENCES } from "@/lib/marketing/sequences";
import { logMarketingView } from "@/lib/marketing/audit";
import { requireMarketingPage } from "@/lib/marketing/page-gate";

export const dynamic = "force-dynamic";

/** The Follow-up system page: a read-only map of the email sequences, from static data. */
export default async function FollowUpSystemPage() {
  const actor = await requireMarketingPage();
  void logMarketingView(actor, "marketing.followup.view");
  return (
    <SequenceMapView
      sequences={SEQUENCES}
      defaultKey={DEFAULT_SEQUENCE_KEY}
      // No canEditMarketing helper exists yet; inline editing is admin-only.
      canEditInline={actor.isAdmin}
    />
  );
}
