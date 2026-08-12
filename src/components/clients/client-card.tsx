import Link from "next/link";
import { AlertTriangle, Pencil } from "lucide-react";

import { initialsOf } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClientStatusPill } from "@/components/clients/client-status-pill";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";

type ClientCardData = {
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

export function ClientCard({ client, delayMs = 0 }: { client: ClientCardData; delayMs?: number }) {
  return (
    <Card
      className="hover-glow-ring relative animate-in fade-in slide-in-from-bottom-1 duration-300 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="absolute right-3 top-3">
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
      <Link href={`/clients/${client.id}`} className="block">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 pr-8 text-base">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {initialsOf(client.name)}
            </span>
            <span className="truncate">{client.name}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <ClientStatusPill status={client.status} />
          <span className="text-sm text-muted-foreground">
            {client.openTaskCount} open task{client.openTaskCount === 1 ? "" : "s"}
          </span>
        </CardContent>
        {client.overdueTaskCount > 0 ? (
          <CardContent className="pt-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status-danger px-2.5 py-0.5 text-xs font-bold text-status-danger-foreground">
              <AlertTriangle className="size-3.5" />
              {client.overdueTaskCount} overdue
            </span>
          </CardContent>
        ) : null}
      </Link>
    </Card>
  );
}
