import { notFound } from "next/navigation";
import { Mail, MapPin, Phone, Pencil, Globe } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ClientLinksSection } from "@/components/clients/client-links-section";
import { HighLevelConnectionSection } from "@/components/clients/highlevel-connection-section";

function InfoRow({ icon: Icon, value, href }: { icon: React.ComponentType<{ className?: string }>; value: string | null; href?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="truncate text-primary underline-offset-4 hover:underline">
          {value}
        </a>
      ) : (
        <span className="truncate">{value}</span>
      )}
    </div>
  );
}

export default async function ClientInfoPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { links: { orderBy: { createdAt: "asc" } }, highLevelConnection: true },
  });
  if (!client) notFound();

  const hasContactInfo = client.contactName || client.contactEmail || client.contactPhone;
  const hasBusinessInfo = client.website || client.address;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-4">
          {hasContactInfo ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Contact</p>
              {client.contactName ? <p className="text-sm">{client.contactName}</p> : null}
              <InfoRow icon={Mail} value={client.contactEmail} href={client.contactEmail ? `mailto:${client.contactEmail}` : undefined} />
              <InfoRow icon={Phone} value={client.contactPhone} />
            </div>
          ) : null}
          {hasBusinessInfo ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Business</p>
              <InfoRow icon={Globe} value={client.website} href={client.website ?? undefined} />
              <InfoRow icon={MapPin} value={client.address} />
            </div>
          ) : null}
          {client.about ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">About</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{client.about}</p>
            </div>
          ) : null}
          {!hasContactInfo && !hasBusinessInfo && !client.about ? (
            <p className="text-sm text-muted-foreground">No client info added yet.</p>
          ) : null}
        </div>
        <ClientFormDialog
          mode="edit"
          clientId={client.id}
          defaultName={client.name}
          defaultStatus={client.status}
          contactName={client.contactName}
          contactEmail={client.contactEmail}
          contactPhone={client.contactPhone}
          website={client.website}
          address={client.address}
          about={client.about}
          trigger={
            <Button variant="ghost" size="icon" aria-label="Edit client info">
              <Pencil className="size-4" />
            </Button>
          }
        />
      </div>

      <ClientLinksSection clientId={client.id} links={client.links} />

      <HighLevelConnectionSection
        clientId={client.id}
        connection={
          client.highLevelConnection
            ? {
                locationId: client.highLevelConnection.locationId,
                connectedAt: client.highLevelConnection.connectedAt.toISOString(),
                lastSyncAt: client.highLevelConnection.lastSyncAt?.toISOString() ?? null,
              }
            : null
        }
      />
    </div>
  );
}
