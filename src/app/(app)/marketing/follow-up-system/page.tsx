import { SequenceMapView } from "@/components/marketing/sequence-map-view";
import { SEQUENCES } from "@/lib/marketing/sequences";
import { requireMarketingPage } from "@/lib/marketing/page-gate";

export const dynamic = "force-dynamic";

/** The Follow-up system page: a read-only map of the email sequences, from static data. */
export default async function FollowUpSystemPage() {
  await requireMarketingPage();
  return <SequenceMapView sequences={SEQUENCES} />;
}
