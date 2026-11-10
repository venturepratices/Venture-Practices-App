import { notFound } from "next/navigation";

import { requireSalesPage } from "@/lib/sales/page-gate";
import { loadLeadAssignmentView, loadStageSettings } from "@/lib/sales/settings";
import { SettingsView } from "@/components/sales/settings-view";

// Sales settings (Decision 28): admins only. "Who gets new leads", "Rules
// (always on)" and "Pipelines and stages". Gated here as well as in the Sales
// layout (layouts do not re-run on navigation). A non-admin Sales user gets
// a real 404, so no `loading.tsx` sits next to this file.
export default async function SalesSettingsPage() {
  const actor = await requireSalesPage();
  if (!actor.isAdmin) notFound();

  const [assignment, pipelines] = await Promise.all([loadLeadAssignmentView(), loadStageSettings()]);
  return <SettingsView assignment={assignment} pipelines={pipelines} />;
}
