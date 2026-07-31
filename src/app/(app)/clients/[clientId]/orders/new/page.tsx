import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getOrCreateOrderTemplate } from "@/app/api/order-template/route";
import { OrderForm } from "@/components/orders/order-form";
import type { OrderTemplateField } from "@/lib/validations/order-template";
import type { Service } from "@/lib/validations/client-order";

export default async function NewClientOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ fromOrderId?: string }>;
}) {
  const { clientId } = await params;
  const { fromOrderId } = await searchParams;
  if (!(await canUseCapability("canManageOrders"))) notFound();

  const [client, latest, template] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } }),
    prisma.clientOrder.findFirst({ where: { clientId }, orderBy: { sequenceNumber: "desc" } }),
    getOrCreateOrderTemplate(),
  ]);
  if (!client) notFound();

  // The document to pre-fill the form from — defaults to the latest, but can
  // be any past document (e.g. clicking "Change Order" from that document's
  // own detail page), so a Change Order can amend from any point in history,
  // not just the current latest. Either way it always lands as the new
  // highest sequenceNumber; nothing in history is overwritten.
  const source = fromOrderId
    ? await prisma.clientOrder.findFirst({ where: { id: fromOrderId, clientId } })
    : latest;

  const templateFields = template.customFields as unknown as OrderTemplateField[];
  const isChangeOrder = !!latest;
  const isFromPastDocument = !!source && source.id !== latest?.id;

  return (
    <div className="max-w-2xl">
      <Link href={`/clients/${clientId}/orders`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Orders
      </Link>
      <h2 className="mt-2 text-lg font-semibold">{isChangeOrder ? "New Change Order" : "New Order"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isChangeOrder
          ? isFromPastDocument
            ? `Amends the client's current order (No. ${latest?.sequenceNumber}) with a new full snapshot — pre-filled from order No. ${source?.sequenceNumber}, not the latest.`
            : `Amends the client's current order (No. ${latest?.sequenceNumber}) with a new full snapshot — pre-filled from the latest document.`
          : "The first Order document for this client — services, fees, ad budget, and notes."}
      </p>

      <div className="mt-6">
        <OrderForm
          clientId={clientId}
          templateFields={templateFields}
          initialServices={(source?.services as unknown as Service[]) ?? []}
          initialAdBudgetCents={source?.adBudgetCents ?? null}
          initialNotes={source?.notes ?? ""}
          initialCustomFieldValues={
            (source?.customFieldValues as unknown as { key: string; value: string | null }[] | undefined) ?? []
          }
        />
      </div>
    </div>
  );
}
