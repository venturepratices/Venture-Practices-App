import { notFound } from "next/navigation";
import { DollarSign, Plus } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { NewOrderTemplateDialog } from "@/components/orders/new-order-template-dialog";
import { OrderTemplateEditor } from "@/components/orders/order-template-editor";
import type { OrderTemplateField } from "@/lib/validations/order-template";

export default async function OrderTemplatesPage() {
  if (!(await canUseCapability("canManageOrders"))) notFound();

  const templates = await prisma.orderTemplate.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Order Templates
            <InfoTip>
              A reusable set of custom fields — e.g. "Standard Retainer" or "One-Time Project." Picking one when
              creating an Order or starting blank both still carry the built-in services, ad budget, and notes
              fields; a template only adds extra fields on top. Editing a template never changes orders already
              created from it.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Reusable custom-field blueprints for starting new orders.</p>
        </div>
        <NewOrderTemplateDialog
          trigger={
            <Button size="sm">
              <Plus className="size-4" />
              New template
            </Button>
          }
        />
      </div>

      <div className="mt-6 space-y-3">
        {templates.length === 0 ? (
          <div className="rounded-lg border">
            <EmptyState icon={DollarSign} title="No templates yet." description="Create one to start building a reusable set of custom fields." />
          </div>
        ) : (
          templates.map((template) => (
            <OrderTemplateEditor
              key={template.id}
              template={{ id: template.id, name: template.name, customFields: template.customFields as unknown as OrderTemplateField[] }}
            />
          ))
        )}
      </div>
    </div>
  );
}
