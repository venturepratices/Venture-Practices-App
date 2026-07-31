import { notFound } from "next/navigation";

import { canUseCapability } from "@/lib/permissions";
import { getOrCreateOrderTemplate } from "@/app/api/order-template/route";
import { OrderTemplateEditor } from "@/components/orders/order-template-editor";
import type { OrderTemplateField } from "@/lib/validations/order-template";

export default async function OrderTemplatePage() {
  if (!(await canUseCapability("canManageOrders"))) notFound();

  const template = await getOrCreateOrderTemplate();
  const customFields = template.customFields as unknown as OrderTemplateField[];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Order Template</h1>
      <p className="mt-1 text-muted-foreground">
        One shared template used for every client's Orders and Change Orders.
      </p>

      <div className="mt-6 rounded-lg border p-4">
        <OrderTemplateEditor initialFields={customFields} />
      </div>
    </div>
  );
}
