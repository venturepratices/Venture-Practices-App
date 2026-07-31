import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getOrCreateOrderTemplate } from "@/app/api/order-template/route";
import { OrderForm } from "@/components/orders/order-form";
import type { OrderTemplateField } from "@/lib/validations/order-template";
import type { Service } from "@/lib/validations/client-order";

export default async function NewClientOrderPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  if (!(await canUseCapability("canManageOrders"))) notFound();

  const [client, latest, template] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } }),
    prisma.clientOrder.findFirst({ where: { clientId }, orderBy: { sequenceNumber: "desc" } }),
    getOrCreateOrderTemplate(),
  ]);
  if (!client) notFound();

  const templateFields = template.customFields as unknown as OrderTemplateField[];
  const isChangeOrder = !!latest;

  return (
    <div className="max-w-2xl">
      <Link href={`/clients/${clientId}/orders`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Orders
      </Link>
      <h2 className="mt-2 text-lg font-semibold">{isChangeOrder ? "New Change Order" : "New Order"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isChangeOrder
          ? `Amends the client's current Order #${latest?.sequenceNumber} with a new full snapshot — pre-filled from the latest document.`
          : "The first Order document for this client — services, fees, ad budget, and notes."}
      </p>

      <div className="mt-6">
        <OrderForm
          clientId={clientId}
          templateFields={templateFields}
          initialServices={(latest?.services as unknown as Service[]) ?? []}
          initialAdBudgetCents={latest?.adBudgetCents ?? null}
          initialNotes={latest?.notes ?? ""}
          initialCustomFieldValues={
            (latest?.customFieldValues as unknown as { key: string; value: string | null }[] | undefined) ?? []
          }
        />
      </div>
    </div>
  );
}
