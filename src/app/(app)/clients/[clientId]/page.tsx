import { notFound } from "next/navigation";
import { Mail, MapPin, Phone, Pencil, Globe } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ClientLinksSection } from "@/components/clients/client-links-section";
import { ClientUsersSection } from "@/components/clients/client-users-section";
import { HighLevelConnectionSection } from "@/components/clients/highlevel-connection-section";

function IntakeField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap text-sm">{value}</p>
    </div>
  );
}

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
    include: {
      links: { orderBy: { createdAt: "asc" } },
      highLevelConnection: true,
      clientUsers: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true } },
      intake: true,
    },
  });
  if (!client) notFound();

  const canEditClient = await canUseCapability("canEditClients");
  const canManageLinks = await canUseCapability("canManageClientLinks");
  const canManageHighLevel = await canUseCapability("canManageHighLevel");
  const canManageClientUsers = await canUseCapability("canManageClientUsers");
  const canViewDirectMail = await canUseCapability("canViewDirectMail");

  const hasContactInfo = client.contactName || client.contactEmail || client.contactPhone;
  const hasSecondaryContact = client.secondaryContactName || client.secondaryContactEmail || client.secondaryContactPhone;
  const hasBusinessInfo = client.website || client.address;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-4">
          {hasContactInfo ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Primary contact</p>
              {client.contactName ? <p className="text-sm">{client.contactName}</p> : null}
              <InfoRow icon={Mail} value={client.contactEmail} href={client.contactEmail ? `mailto:${client.contactEmail}` : undefined} />
              <InfoRow icon={Phone} value={client.contactPhone} />
            </div>
          ) : null}
          {hasSecondaryContact ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Secondary contact</p>
              {client.secondaryContactName ? <p className="text-sm">{client.secondaryContactName}</p> : null}
              <InfoRow
                icon={Mail}
                value={client.secondaryContactEmail}
                href={client.secondaryContactEmail ? `mailto:${client.secondaryContactEmail}` : undefined}
              />
              <InfoRow icon={Phone} value={client.secondaryContactPhone} />
            </div>
          ) : null}
          {hasBusinessInfo ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Business</p>
              <InfoRow icon={Globe} value={client.website} href={client.website ?? undefined} />
              <InfoRow icon={MapPin} value={client.address} />
            </div>
          ) : null}
          {client.source ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Source</p>
              <p className="text-sm text-muted-foreground">{client.source}</p>
            </div>
          ) : null}
          {client.about ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">About</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{client.about}</p>
            </div>
          ) : null}
          {!hasContactInfo && !hasSecondaryContact && !hasBusinessInfo && !client.source && !client.about ? (
            <p className="text-sm text-muted-foreground">No client info added yet.</p>
          ) : null}
        </div>
        {canEditClient ? (
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
              <Button variant="ghost" size="icon" aria-label="Edit client info">
                <Pencil className="size-4" />
              </Button>
            }
          />
        ) : null}
      </div>

      <ClientLinksSection clientId={client.id} links={client.links} canManage={canManageLinks} />

      <ClientUsersSection clientId={client.id} clientUsers={client.clientUsers} canManage={canManageClientUsers} />

      {canViewDirectMail ? (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">Direct Mail intake</p>
          {client.intake ? (
            <div className="space-y-3">
              <IntakeField label="Target audience" value={client.intake.targetAudience} />
              <IntakeField label="Typical offer" value={client.intake.offerDetails} />
              <IntakeField label="Brand guidelines" value={client.intake.brandGuidelinesUrl} />
              <IntakeField label="Additional notes" value={client.intake.additionalNotes} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not submitted yet — the client fills this in via their portal.</p>
          )}
        </div>
      ) : null}

      {canManageHighLevel ? (
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
      ) : null}
    </div>
  );
}
