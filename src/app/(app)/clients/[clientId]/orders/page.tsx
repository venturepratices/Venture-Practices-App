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

  // Group into independent order lines (a lineage's grouping key is its root
  // document's id — either rootOrderId, or the row's own id when it IS the
  // root). Orders is already sorted newest-first, so the first row seen per
  // lineage is that lineage's currently-active document.
  const lineages = new Map<string, typeof orders>();
  for (const order of orders) {
    const key = order.rootOrderId ?? order.id;
    const bucket = lineages.get(key);
    if (bucket) bucket.push(order);
    else lineages.set(key, [order]);
  }
  const activeOrders = [...lineages.values()].map((docs) => docs[0]);
  const previousOrders = [...lineages.values()]
    .flatMap((docs) => docs.slice(1))
    .sort((a, b) => b.sequenceNumber - a.sequenceNumber);

  // Resolve each document's parent (the exact document it was amended from)
  // to a title so the list can show "amended from X" instead of a sequence
  // number, which jumps around once a client has more than one order line.
  const titleById = new Map(orders.map((o) => [o.id, o.title]));
  const withParentTitle = (docs: typeof orders) =>
    docs.map((o) => ({
      ...o,
      parentTitle: o.parentOrderId ? titleById.get(o.parentOrderId) ?? "Untitled order" : null,
    }));

  const activeServices = activeOrders.flatMap((o) => (o.services as unknown as Service[]) ?? []).filter((s) => s.status === "ACTIVE");
  const totalMonthlyCents = activeServices.reduce((sum, s) => sum + s.feeCents, 0);
  const totalAdBudgetCents = activeOrders.reduce((sum, o) => sum + (o.adBudgetCents ?? 0), 0);

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

      {activeOrders.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-6 rounded-lg border bg-muted/30 px-4 py-3">
          <div>
            <p className="text-xs text-muted-foreground">Active services</p>
            <p className="text-xl font-semibold">{activeServices.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total monthly</p>
            <p className="text-xl font-semibold">{formatCurrency(totalMonthlyCents)}</p>
          </div>
          {totalAdBudgetCents > 0 ? (
            <div>
              <p className="text-xs text-muted-foreground">Ad budget</p>
              <p className="text-xl font-semibold">{formatCurrency(totalAdBudgetCents)}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Active orders</p>
        <OrderList
          clientId={clientId}
          orders={withParentTitle(activeOrders)}
          emptyTitle="No active orders yet."
          emptyDescription="Create the first Order to record this client's services, fees, and ad budget."
        />
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Previous orders</p>
        <OrderList
          clientId={clientId}
          orders={withParentTitle(previousOrders)}
          emptyTitle="No previous orders."
          emptyDescription="Superseded documents will show up here once an active order gets a Change Order."
        />
      </div>
    </div>
  );
}
