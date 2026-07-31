import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Download, FilePlus2 } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusPillBase } from "@/components/ui/status-pill";
import type { Service } from "@/lib/validations/client-order";

const SERVICE_STATUS_TONE = { ACTIVE: "success", PAUSED: "warning", CANCELLED: "neutral" } as const;
const SERVICE_STATUS_LABEL = { ACTIVE: "Active", PAUSED: "Paused", CANCELLED: "Cancelled" } as const;

export default async function ClientOrderDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; orderId: string }>;
}) {
  const { clientId, orderId } = await params;
  if (!(await canUseCapability("canViewOrders"))) notFound();
  const canManage = await canUseCapability("canManageOrders");

  const order = await prisma.clientOrder.findFirst({
    where: { id: orderId, clientId },
    include: { client: { select: { name: true } }, createdBy: { select: { name: true } } },
  });
  if (!order) notFound();

  const services = order.services as unknown as Service[];
  const customFieldValues = order.customFieldValues as unknown as { key: string; label: string; value: string | null }[];
  const activeTotalCents = services.filter((s) => s.status === "ACTIVE").reduce((sum, s) => sum + s.feeCents, 0);

  return (
    <div className="max-w-2xl">
      <Link href={`/clients/${clientId}/orders`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Orders
      </Link>

      <div className="mt-4 rounded-lg border p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{order.title || "Untitled order"}</h2>
            <p className="text-sm text-muted-foreground">
              {order.client.name} · Order No. {order.sequenceNumber}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              render={
                <a href={`/api/client-orders/${order.id}/pdf`} download>
                  <Download className="size-4" />
                  Download PDF
                </a>
              }
            />
            {canManage ? (
              <Button
                render={
                  <Link href={`/clients/${clientId}/orders/new?fromOrderId=${order.id}`}>
                    <FilePlus2 className="size-4" />
                    Change Order
                  </Link>
                }
              />
            ) : null}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateTime(order.createdAt)}
          {order.createdBy ? ` · Created by ${order.createdBy.name}` : ""}
        </p>

        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Services</p>
          <div className="mt-2 divide-y rounded-lg border">
            {services.map((service, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{service.name}</span>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-muted-foreground">{formatCurrency(service.feeCents)}/mo</span>
                  <StatusPillBase tone={SERVICE_STATUS_TONE[service.status]} label={SERVICE_STATUS_LABEL[service.status]} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-right text-sm font-medium">Total (active): {formatCurrency(activeTotalCents)}/mo</p>
        </div>

        {order.adBudgetCents != null ? (
          <div className="mt-6">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Ad Budget</p>
            <p className="mt-1 text-sm">{formatCurrency(order.adBudgetCents)}/mo</p>
          </div>
        ) : null}

        {customFieldValues.length > 0 ? (
          <div className="mt-6">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Additional Details</p>
            <div className="mt-2 space-y-1.5">
              {customFieldValues.map((field) => (
                <div key={field.key} className="flex gap-3 text-sm">
                  <span className="w-40 shrink-0 font-medium">{field.label}</span>
                  <span className="text-muted-foreground">{field.value ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {order.notes ? (
          <div className="mt-6">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Notes</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{order.notes}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
