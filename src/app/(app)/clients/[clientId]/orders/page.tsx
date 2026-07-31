import { notFound } from "next/navigation";
import Link from "next/link";
import { DollarSign, FilePlus2, FileText } from "lucide-react";

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

  const latest = orders[0];
  const latestServices = (latest?.services as unknown as Service[]) ?? [];
  const activeServices = latestServices.filter((s) => s.status === "ACTIVE");
  const totalMonthlyCents = activeServices.reduce((sum, s) => sum + s.feeCents, 0);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Orders</h2>
        {canManage ? (
          <Button
            render={
              <Link href={`/clients/${clientId}/orders/new`}>
                <FilePlus2 className="size-4" />
                {orders.length === 0 ? "New Order" : "New Change Order"}
              </Link>
            }
          />
        ) : null}
      </div>

      {latest ? (
        <div className="mt-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Active services</p>
              <p className="text-xl font-semibold">{activeServices.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total monthly</p>
              <p className="text-xl font-semibold">{formatCurrency(totalMonthlyCents)}</p>
            </div>
            {latest.adBudgetCents != null ? (
              <div>
                <p className="text-xs text-muted-foreground">Ad budget</p>
                <p className="text-xl font-semibold">{formatCurrency(latest.adBudgetCents)}</p>
              </div>
            ) : null}
          </div>
          <div className="mt-3">
            <StatusBar
              segments={[
                { tone: "success", count: latestServices.filter((s) => s.status === "ACTIVE").length },
                { tone: "warning", count: latestServices.filter((s) => s.status === "PAUSED").length },
                { tone: "neutral", count: latestServices.filter((s) => s.status === "CANCELLED").length },
              ]}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        {orders.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title="No orders yet."
            description="Create the first Order to record this client's services, fees, and ad budget."
          />
        ) : (
          <div className="divide-y rounded-lg border">
            {orders.map((order) => {
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
    </div>
  );
}
