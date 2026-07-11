import Link from "next/link";
import { AlertTriangle, Pencil } from "lucide-react";

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
};

export function ClientCard({ client }: { client: ClientCardData }) {
  return (
    <Card className="relative transition-shadow hover:shadow-md">
      <div className="absolute right-3 top-3">
        <ClientFormDialog
          mode="edit"
          clientId={client.id}
          defaultName={client.name}
          defaultStatus={client.status}
          trigger={
            <Button variant="ghost" size="icon" aria-label={`Edit ${client.name}`}>
              <Pencil className="size-4" />
            </Button>
          }
        />
      </div>
      <Link href={`/clients/${client.id}/tasks`} className="block">
        <CardHeader>
          <CardTitle className="pr-8 text-base">{client.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <ClientStatusPill status={client.status} />
          <span className="text-sm text-muted-foreground">
            {client.openTaskCount} open task{client.openTaskCount === 1 ? "" : "s"}
          </span>
        </CardContent>
        {client.overdueTaskCount > 0 ? (
          <CardContent className="pt-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800 dark:bg-red-900/40 dark:text-red-300">
              <AlertTriangle className="size-3.5" />
              {client.overdueTaskCount} overdue
            </span>
          </CardContent>
        ) : null}
      </Link>
    </Card>
  );
}
