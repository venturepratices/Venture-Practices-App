import { Plus } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { ClientCard } from "@/components/clients/client-card";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";

export default async function ClientsPage() {
  const [clients, overdueByClient] = await Promise.all([
    prisma.client.findMany({
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
          <h1 className="text-2xl font-semibold">All Clients</h1>
          <p className="mt-1 text-muted-foreground">Every sub-account, at a glance.</p>
        </div>
        <ClientFormDialog
          mode="create"
          trigger={
            <Button>
              <Plus className="size-4" />
              New client
            </Button>
          }
        />
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
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
