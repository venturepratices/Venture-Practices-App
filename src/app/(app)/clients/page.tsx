import Link from "next/link";
import { Building2, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { accessibleClientFilter, canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCompleteStatusId } from "@/lib/task-status";
import { Button } from "@/components/ui/button";
import { ClientCard } from "@/components/clients/client-card";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/info-tip";

const PAGE_SIZE = 60;

type SearchParams = { page?: string };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const clientWhere = await accessibleClientFilter("id");
  const canCreate = await canUseCapability("canCreateClients");
  const completeStatusId = await getCompleteStatusId();
  const [clients, totalCount, overdueByClient] = await Promise.all([
    prisma.client.findMany({
      where: clientWhere,
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { tasks: { where: { statusId: { not: completeStatusId } } } },
        },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.client.count({ where: clientWhere }),
    prisma.task.groupBy({
      by: ["clientId"],
      where: { statusId: { not: completeStatusId }, deadline: { lt: new Date() }, clientId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const overdueCounts = Object.fromEntries(overdueByClient.map((row) => [row.clientId, row._count._all]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rangeStartIndex = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEndIndex = Math.min(page * PAGE_SIZE, totalCount);

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
        {canCreate ? (
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
        <EmptyState
          icon={Building2}
          title="No clients yet."
          description="Add your first one to get started."
          className="mt-10"
        />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client, i) => (
            <ClientCard
              key={client.id}
              delayMs={Math.min(i * 40, 400)}
              client={{
                id: client.id,
                name: client.name,
                status: client.status,
                openTaskCount: client._count.tasks,
                overdueTaskCount: overdueCounts[client.id] ?? 0,
                contactName: client.contactName,
                contactEmail: client.contactEmail,
                contactPhone: client.contactPhone,
                secondaryContactName: client.secondaryContactName,
                secondaryContactEmail: client.secondaryContactEmail,
                secondaryContactPhone: client.secondaryContactPhone,
                website: client.website,
                address: client.address,
                about: client.about,
                source: client.source,
                slackChannelId: client.slackChannelId,
              }}
            />
          ))}
        </div>
      )}

      {totalCount > PAGE_SIZE ? (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Showing {rangeStartIndex}–{rangeEndIndex} of {totalCount}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} render={<Link href={page - 1 > 1 ? `/clients?page=${page - 1}` : "/clients"} scroll={false} />}>
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              render={<Link href={`/clients?page=${page + 1}`} scroll={false} />}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
