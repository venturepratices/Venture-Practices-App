import { notFound } from "next/navigation";

import { requireSalesPage } from "@/lib/sales/page-gate";
import { loadImportStatus } from "@/lib/sales/pipedrive/status";
import { ImportView } from "@/components/sales/import-view";

// Copy from Pipedrive: admins only. Gated here as well as in the Sales layout
// (layouts do not re-run on navigation). A non-admin Sales user gets a real
// 404, so no `loading.tsx` sits next to this file. Loading the page reads the
// database only; it never calls Pipedrive.
export default async function PipedriveImportPage() {
  const actor = await requireSalesPage();
  if (!actor.isAdmin) notFound();

  const status = await loadImportStatus();
  return <ImportView initial={status} />;
}
