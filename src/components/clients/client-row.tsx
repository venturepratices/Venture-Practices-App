import Link from "next/link";
import { AlertTriangle, Pencil } from "lucide-react";

import { initialsOf } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ClientStatusPill } from "@/components/clients/client-status-pill";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";

// Below md, only Client / Status / Open show — Primary contact and the edit
// affordance wait for more room, same idea as the task list's column
// collapse (the row itself is still tappable to open the client on mobile).
const GRID_CLASS = "grid grid-cols-[minmax(0,1fr)_84px_84px] items-center gap-2 md:grid-cols-[minmax(0,2fr)_110px_100px_1fr] md:gap-3";

export function ClientListHeader() {
  return (
    <div className={`${GRID_CLASS} border-b px-4 py-2.5 text-xs font-bold tracking-wide text-foreground`}>
      <span>Client</span>
      <span>Status</span>
      <span>Open</span>
      <span className="hidden md:block">Primary contact</span>
    </div>
  );
}

type ClientRowData = {
  id: string;
  name: string;
  status: string;
  openTaskCount: number;
  overdueTaskCount: number;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  secondaryContactName: string | null;
  secondaryContactEmail: string | null;
  secondaryContactPhone: string | null;
  website: string | null;
  address: string | null;
  about: string | null;
  source: string | null;
  slackChannelId: string | null;
};

export function ClientRow({ client, delayMs = 0 }: { client: ClientRowData; delayMs?: number }) {
  return (
    <div className="group relative animate-in fade-in slide-in-from-bottom-1 duration-300" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 md:block">
        <ClientFormDialog
          mode="edit"
          clientId={client.id}
          defaultName={client.name}
          defaultStatus={client.status}
          contactName={client.contactName}
          contactEmail={client.contactEmail}
          contactPhone={client.contactPhone}
          secondaryContactName={client.secondaryContactName}
          secondaryContactEmail={client.secondaryContactEmail}
          secondaryContactPhone={client.secondaryContactPhone}
          website={client.website}
          address={client.address}
          about={client.about}
          source={client.source}
          slackChannelId={client.slackChannelId}
          trigger={
            <Button variant="ghost" size="icon" aria-label={`Edit ${client.name}`}>
              <Pencil className="size-4" />
            </Button>
          }
        />
      </div>
      <Link href={`/clients/${client.id}`} className={`${GRID_CLASS} py-3 pl-4 pr-3 text-sm transition-colors hover:bg-muted md:pr-12`}>
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
            {initialsOf(client.name)}
          </span>
          <span className="min-w-0 truncate font-medium">{client.name}</span>
        </span>
        <span>
          <ClientStatusPill status={client.status} />
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {client.openTaskCount} open
          {client.overdueTaskCount > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-status-danger" title={`${client.overdueTaskCount} overdue`}>
              <AlertTriangle className="size-3" />
              {client.overdueTaskCount}
            </span>
          ) : null}
        </span>
        <span className="hidden min-w-0 truncate text-muted-foreground md:block">{client.contactName ?? "—"}</span>
      </Link>
    </div>
  );
}
