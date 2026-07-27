import { redirect } from "next/navigation";

import { getClientUserSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ClientIntakeForm } from "@/components/portal/client-intake-form";

export default async function PortalIntakePage() {
  const clientUser = await getClientUserSession();
  if (!clientUser) redirect("/login");

  const [client, intake] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientUser.clientId },
      select: { contactName: true, contactEmail: true, contactPhone: true, website: true, about: true },
    }),
    prisma.clientIntake.findUnique({ where: { clientId: clientUser.clientId } }),
  ]);

  return (
    <div className="max-w-2xl p-6">
      <h1 className="text-lg font-semibold">Business info</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tell us about your business — save whatever you have now, come back and fill in the rest whenever you're ready.
      </p>
      <ClientIntakeForm initial={{ ...client, ...intake }} />
    </div>
  );
}
