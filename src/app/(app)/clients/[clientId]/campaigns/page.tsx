import { notFound } from "next/navigation";
import { Mail, Plus, Sparkles } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/info-tip";
import { CampaignRow } from "@/components/programs/campaign-row";
import { CampaignsTimeline } from "@/components/programs/campaigns-timeline";
import { NewCampaignDialog } from "@/components/programs/new-campaign-dialog";
import { CampaignWizardDialog } from "@/components/programs/wizard/wizard-shell";

export default async function ClientCampaignsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  // Client-access is enforced by the layout; this adds the Direct Mail capability.
  if (!(await canUseCapability("canViewDirectMail"))) notFound();
  const canManage = await canUseCapability("canManageDirectMail");

  const [campaigns, templates] = await Promise.all([
    prisma.campaign.findMany({
      where: { clientId },
      include: { tasks: { select: { id: true } } },
      orderBy: { sequenceNumber: "asc" },
    }),
    prisma.programTemplate.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Direct Mail
          <InfoTip>
            Each campaign is one physical mailing for this client, moving through Planning → Creative → Review →
            Approval → Production → Mailed → Results. Use the Campaign Generator to create several at once (e.g. a
            run of monthly mailers), or add campaigns one at a time.
          </InfoTip>
        </h2>
        {canManage ? (
          <div className="flex items-center gap-2">
            <CampaignWizardDialog
              clientId={clientId}
              templates={templates}
              trigger={
                <Button size="sm" variant="outline">
                  <Sparkles className="size-4" />
                  Campaign Generator
                </Button>
              }
            />
            <NewCampaignDialog
              clientId={clientId}
              trigger={
                <Button size="sm">
                  <Plus className="size-4" />
                  New campaign
                </Button>
              }
            />
          </div>
        ) : null}
      </div>

      {campaigns.length > 0 ? (
        <div className="mt-6">
          <CampaignsTimeline campaigns={campaigns} clientId={clientId} />
        </div>
      ) : null}

      <div className="mt-6">
        <div className="rounded-lg border divide-y">
          {campaigns.length === 0 ? (
            <EmptyState icon={Mail} title="No Direct Mail campaigns yet." className="py-6" />
          ) : (
            campaigns.map((campaign, i) => (
              <CampaignRow
                key={campaign.id}
                clientId={clientId}
                campaign={campaign}
                canManage={canManage}
                delayMs={Math.min(i * 40, 400)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
