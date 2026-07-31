import Link from "next/link";
import { CornerDownRight, DollarSign, FileText } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Service } from "@/lib/validations/client-order";

type OrderListItem = {
  id: string;
  type: "ORDER" | "CHANGE_ORDER";
  parentOrderId: string | null;
  parentTitle: string | null;
  title: string | null;
  services: unknown;
  adBudgetCents: number | null;
  createdAt: Date;
};

function totalActiveCents(services: unknown) {
  const list = (services as Service[] | null) ?? [];
  return list.filter((s) => s.status === "ACTIVE").reduce((sum, s) => sum + s.feeCents, 0);
}

const GRID = "grid grid-cols-[minmax(0,1fr)_140px] items-center gap-3 md:grid-cols-[minmax(0,1fr)_160px_130px_130px_130px_120px]";

export function OrderList({
  clientId,
  orders,
  emptyTitle,
  emptyDescription,
}: {
  clientId: string;
  orders: OrderListItem[];
  emptyTitle: string;
  emptyDescription?: string;
}) {
  if (orders.length === 0) {
    return <EmptyState icon={DollarSign} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="rounded-lg border">
      <div className={`${GRID} border-b px-3 py-2.5 text-xs font-bold tracking-wide text-foreground`}>
        <span>Title</span>
        <span>Parent order</span>
        <span className="hidden md:block">Date created</span>
        <span className="hidden md:block">Date changed</span>
        <span className="hidden md:block">Total amount</span>
        <span className="hidden md:block">Ad budget</span>
      </div>
      <div className="divide-y">
        {orders.map((order) => {
          const totalCents = totalActiveCents(order.services);
          return (
            <Link
              key={order.id}
              href={`/clients/${clientId}/orders/${order.id}`}
              className={`${GRID} block px-3 py-2.5 text-sm transition-colors hover:bg-muted`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 truncate">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium" title={order.title ?? undefined}>
                    {order.title || "Untitled order"}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground md:hidden">
                  {[
                    order.parentTitle ? `From "${order.parentTitle}"` : null,
                    order.type === "ORDER" ? `Created ${formatDate(order.createdAt)}` : `Changed ${formatDate(order.createdAt)}`,
                    `${formatCurrency(totalCents)}/mo`,
                    order.adBudgetCents != null ? `Ad budget ${formatCurrency(order.adBudgetCents)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="min-w-0 truncate text-muted-foreground">
                {order.parentTitle ? (
                  <span className="flex items-center gap-1" title={order.parentTitle}>
                    <CornerDownRight className="size-3.5 shrink-0" />
                    <span className="truncate">{order.parentTitle}</span>
                  </span>
                ) : (
                  "Original"
                )}
              </span>
              <span className="hidden truncate text-muted-foreground md:block">
                {order.type === "ORDER" ? formatDate(order.createdAt) : "—"}
              </span>
              <span className="hidden truncate text-muted-foreground md:block">
                {order.type === "CHANGE_ORDER" ? formatDate(order.createdAt) : "—"}
              </span>
              <span className="hidden truncate text-muted-foreground md:block">{formatCurrency(totalCents)}/mo</span>
              <span className="hidden truncate text-muted-foreground md:block">
                {order.adBudgetCents != null ? formatCurrency(order.adBudgetCents) : "—"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
