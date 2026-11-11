import { redirect } from "next/navigation";

import { requireSalesPage } from "@/lib/sales/page-gate";

// /sales has no screen of its own yet: it opens the Deals board. Gated first,
// so someone without Sales access gets a 404 here, not a redirect that would
// confirm the area exists.
export default async function SalesPage() {
  await requireSalesPage();
  redirect("/sales/deals");
}
