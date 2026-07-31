import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, DollarSign, FilePlus2, FileText } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBar } from "@/components/dashboard/status-bar";
import type { Service } from "@/lib/validations/client-order";

export default async function ClientOrdersPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  if (!(await canUseCapability("canViewOrders"))) notFound();
  const canManage = await canUseCapability("canManageOrders");

  const orders = await prisma.clientOrder.findMany({
    where: { clientId },
    include: { createdBy: { select: { name: true } } },
    orderBy: { sequenceNumber: "desc" },
  });

  // The most recent document is the client's "live" state; everything else
  // is history — kept forever, but visually separated so it's obvious which
  // one is actually in effect right now.
  const current = orders[0];
  const previous = orders.slice(1);
  const currentServices = (current?.services as unknown as Service[]) ?? [];
  const activeServices = currentServices.filter((s) => s.status === "ACTIVE");
  const totalMonthlyCents = activeServices.reduce((sum, s) => sum + s.feeCents, 0);
  const currentDocLabel = current ? (current.type === "ORDER" ? `Order #${current.sequenceNumber}` : `Change Order #${current.sequenceNumber}`) : null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Orders</h2>
        {canManage ? (
          <Button
            render={
              <Link href={`/clients/${clientId}/orders/new`}>
                <FilePlus2 className="size-4" />
                Add Order
              </Link>
            }
          />
        ) : null}
      </div>

      {current ? (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Current order</p>
          <Link
            href={`/clients/${clientId}/orders/${current.id}`}
            className="mt-2 block rounded-lg border-2 border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">
                {currentDocLabel}
                {current.title ? ` — ${current.title}` : ""}
              </p>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDate(current.createdAt)}
              {current.createdBy ? ` · Created by ${current.createdBy.name}` : ""}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-6">
              <div>
                <p className="text-xs text-muted-foreground">Active services</p>
                <p className="text-xl font-semibold">{activeServices.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total monthly</p>
                <p className="text-xl font-semibold">{formatCurrency(totalMonthlyCents)}</p>
              </div>
              {current.adBudgetCents != null ? (
                <div>
                  <p className="text-xs text-muted-foreground">Ad budget</p>
                  <p className="text-xl font-semibold">{formatCurrency(current.adBudgetCents)}</p>
                </div>
              ) : null}
            </div>
            <div className="mt-3">
              <StatusBar
                segments={[
                  { tone: "success", count: currentServices.filter((s) => s.status === "ACTIVE").length },
                  { tone: "warning", count: currentServices.filter((s) => s.status === "PAUSED").length },
                  { tone: "neutral", count: currentServices.filter((s) => s.status === "CANCELLED").length },
                ]}
              />
            </div>
          </Link>
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={DollarSign}
            title="No orders yet."
            description="Create the first Order to record this client's services, fees, and ad budget."
          />
        </div>
      )}

      {current ? (
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Previous orders</p>
          {previous.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No previous orders yet — this is the first one.</p>
          ) : (
            <div className="mt-2 divide-y rounded-lg border">
              {previous.map((order) => {
                const docLabel = order.type === "ORDER" ? `Order #${order.sequenceNumber}` : `Change Order #${order.sequenceNumber}`;
                return (
                  <Link
                    key={order.id}
                    href={`/clients/${clientId}/orders/${order.id}`}
                    className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {docLabel}
                        {order.title ? ` — ${order.title}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(order.createdAt)}
                        {order.createdBy ? ` · Created by ${order.createdBy.name}` : ""}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
