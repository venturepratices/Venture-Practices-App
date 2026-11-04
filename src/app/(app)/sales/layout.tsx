import { Suspense } from "react";

import { requireSalesPage } from "@/lib/sales/page-gate";
import { SalesShortcuts } from "@/components/sales/sales-shortcuts";

// The Sales area shell. The gate here keeps the shortcuts and their help text
// away from people without Sales access (they get a 404). Layouts do not re-run
// on navigation, so every Sales page also calls requireSalesPage() itself.
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  await requireSalesPage();

  return (
    <>
      {children}
      {/* Reads the URL (?deal=), so it sits in its own Suspense boundary. */}
      <Suspense fallback={null}>
        <SalesShortcuts />
      </Suspense>
    </>
  );
}
