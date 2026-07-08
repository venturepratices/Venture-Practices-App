import Link from "next/link";
import { Pencil } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClientStatusPill } from "@/components/clients/client-status-pill";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";

type ClientCardData = {
  id: string;
  name: string;
  status: string;
  openTaskCount: number;
};

export function ClientCard({ client }: { client: ClientCardData }) {
  return (
    <Card className="relative transition-shadow hover:shadow-md">
      <div className="absolute right-3 top-3" onClick={(event) => event.stopPropagation()}>
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
      </Link>
    </Card>
  );
}
