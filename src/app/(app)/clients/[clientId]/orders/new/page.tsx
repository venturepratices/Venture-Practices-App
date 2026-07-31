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

  const [client, source, template] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } }),
    fromOrderId ? prisma.clientOrder.findFirst({ where: { id: fromOrderId, clientId } }) : Promise.resolve(null),
    getOrCreateOrderTemplate(),
  ]);
  if (!client) notFound();
  // A fromOrderId was given but doesn't belong to this client — don't silently
  // fall through to a blank "new order" form for the wrong intent.
  if (fromOrderId && !source) notFound();

  const templateFields = template.customFields as unknown as OrderTemplateField[];
  // Whether this is a Change Order is decided purely by whether a specific
  // source document was given — never by whether the client already has other
  // orders. That's what lets "Add Order" always start a brand-new, independent
  // order line instead of silently amending whatever's currently active.
  const isChangeOrder = !!source;

  return (
    <div className="max-w-2xl">
      <Link href={`/clients/${clientId}/orders`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Orders
      </Link>
      <h2 className="mt-2 text-lg font-semibold">{isChangeOrder ? "New Change Order" : "New Order"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isChangeOrder
          ? `Amends order No. ${source!.sequenceNumber} with a new full snapshot for that order line — other active orders for this client are unaffected.`
          : "Creates a new, independent order for this client — any existing active orders are left exactly as they are."}
      </p>

      <div className="mt-6">
        <OrderForm
          clientId={clientId}
          fromOrderId={fromOrderId ?? null}
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
