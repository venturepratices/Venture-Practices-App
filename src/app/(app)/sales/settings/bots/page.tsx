import { notFound } from "next/navigation";

import { loadBotsScreen } from "@/lib/sales/bots-screen";
import { requireSalesPage } from "@/lib/sales/page-gate";
import { BotsView } from "@/components/sales/bots-view";

// Bots (bot keys): admins only. Gated here as well as in the Sales layout
// (layouts do not re-run on navigation). A non-admin Sales user gets a real
// 404, so no `loading.tsx` sits next to this file. Loading the page reads the
// database only; it never shows or makes a key.
export default async function BotsPage() {
  const actor = await requireSalesPage();
  if (!actor.isAdmin) notFound();

  const data = await loadBotsScreen();
  return <BotsView data={data} />;
}
