import { redirect } from "next/navigation";

import { requireMarketingPage } from "@/lib/marketing/page-gate";

/** Marketing landing: sends everyone to the Follow-up system page. */
export default async function MarketingPage() {
  await requireMarketingPage();
  redirect("/marketing/follow-up-system");
}
