import { Plus } from "lucide-react";

import { accessibleClientFilter, isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { ClientCard } from "@/components/clients/client-card";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { InfoTip } from "@/components/info-tip";

export default async function ClientsPage() {
  const clientWhere = await accessibleClientFilter("id");
  const admin = await isAdmin();
  const [clients, overdueByClient] = await Promise.all([
    prisma.client.findMany({
      where: clientWhere,
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { tasks: { where: { status: { not: "COMPLETE" } } } },
        },
      },
    }),
    prisma.task.groupBy({
      by: ["clientId"],
      where: { status: { not: "COMPLETE" }, deadline: { lt: new Date() }, clientId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const overdueCounts = Object.fromEntries(overdueByClient.map((row) => [row.clientId, row._count._all]));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            All Clients
            <InfoTip>
              Every client is its own sub-account with its own task list. A red badge on a card means that client has
              overdue tasks — click any card to open its tasks.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Every sub-account, at a glance.</p>
        </div>
        {admin ? (
          <ClientFormDialog
            mode="create"
            trigger={
              <Button>
                <Plus className="size-4" />
                New client
              </Button>
            }
          />
        ) : null}
      </div>

      {clients.length === 0 ? (
        <p className="mt-10 text-center text-muted-foreground">No clients yet. Add your first one to get started.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <ClientCard
              key={client.id}
              client={{
                id: client.id,
                name: client.name,
                status: client.status,
                openTaskCount: client._count.tasks,
                overdueTaskCount: overdueCounts[client.id] ?? 0,
                contactName: client.contactName,
                contactEmail: client.contactEmail,
                contactPhone: client.contactPhone,
                website: client.website,
                address: client.address,
                about: client.about,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
