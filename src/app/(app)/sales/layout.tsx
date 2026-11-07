import { Suspense } from "react";

import { requireSalesPage } from "@/lib/sales/page-gate";
import { DealPanel } from "@/components/sales/deal-panel";
import { LeadPanel } from "@/components/sales/lead-panel";
import { SalesShortcuts } from "@/components/sales/sales-shortcuts";

// The Sales area shell. The gate here keeps the shortcuts and their help text
// away from people without Sales access (they get a 404). Layouts do not re-run
// on navigation, so every Sales page also calls requireSalesPage() itself.
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  await requireSalesPage();

  return (
    <>
      {children}
      {/* They read the URL (?deal=, ?lead=), so they sit in their own Suspense boundary. One panel shows at a time. */}
      <Suspense fallback={null}>
        <SalesShortcuts />
        <DealPanel />
        <LeadPanel />
      </Suspense>
    </>
  );
}
