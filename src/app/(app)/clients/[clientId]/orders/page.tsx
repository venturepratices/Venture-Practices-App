import { notFound } from "next/navigation";
import Link from "next/link";
import { FilePlus2 } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OrderList } from "@/components/orders/order-list";
import type { Service } from "@/lib/validations/client-order";

export default async function ClientOrdersPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  if (!(await canUseCapability("canViewOrders"))) notFound();
  const canManage = await canUseCapability("canManageOrders");

  const orders = await prisma.clientOrder.findMany({
    where: { clientId },
    orderBy: { sequenceNumber: "desc" },
  });

  const current = orders[0];
  const currentServices = (current?.services as unknown as Service[]) ?? [];
  const activeServices = currentServices.filter((s) => s.status === "ACTIVE");
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
                Add Order
              </Link>
            }
          />
        ) : null}
      </div>

      {current ? (
        <div className="mt-4 flex flex-wrap items-center gap-6 rounded-lg border bg-muted/30 px-4 py-3">
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
      ) : null}

      <div className="mt-4">
        <OrderList clientId={clientId} orders={orders} />
      </div>
    </div>
  );
}
