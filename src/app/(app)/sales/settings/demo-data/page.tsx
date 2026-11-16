import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireSalesPage } from "@/lib/sales/page-gate";
import { TEST_PREFIX } from "@/lib/sales/demo-seed";
import { DemoDataView } from "@/components/sales/demo-data-view";

// Admin-only. Shows how many TEST * rows are already in the system and lets the
// admin add or remove the demo set after typing their password. Loading the
// page reads the database only.
export default async function DemoDataPage() {
  const actor = await requireSalesPage();
  if (!actor.isAdmin) notFound();

  const [organizations, people, leads, deals, activities, notes] = await Promise.all([
    prisma.salesOrganization.count({ where: { name: { startsWith: TEST_PREFIX } } }),
    prisma.salesPerson.count({ where: { name: { startsWith: TEST_PREFIX } } }),
    prisma.salesLead.count({ where: { title: { startsWith: TEST_PREFIX } } }),
    prisma.salesDeal.count({ where: { title: { startsWith: TEST_PREFIX } } }),
    prisma.salesActivity.count({ where: { subject: { startsWith: TEST_PREFIX } } }),
    prisma.salesNote.count({ where: { body: { startsWith: "TEST note:" } } }),
  ]);

  return (
    <DemoDataView
      initialCounts={{ organizations, people, leads, deals, activities, notes }}
    />
  );
}
