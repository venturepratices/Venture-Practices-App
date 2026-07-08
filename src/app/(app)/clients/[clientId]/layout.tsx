import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { SubAccountNav } from "@/components/layout/sub-account-nav";
import { ClientStatusPill } from "@/components/clients/client-status-pill";

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) notFound();

  return (
    <div className="-m-6 flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <h1 className="text-xl font-semibold">{client.name}</h1>
        <ClientStatusPill status={client.status} />
      </div>
      <SubAccountNav clientId={clientId} />
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  );
}
