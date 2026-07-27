import { notFound } from "next/navigation";
import { Mail, Plus } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/info-tip";
import { NewProgramDialog } from "@/components/programs/new-program-dialog";
import { ProgramCard } from "@/components/programs/program-card";

export default async function ClientProgramsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  // Client-access is enforced by the layout; this adds the Direct Mail capability.
  if (!(await canUseCapability("canViewDirectMail"))) notFound();
  const canManage = await canUseCapability("canManageDirectMail");

  const [programs, teamMembers] = await Promise.all([
    prisma.program.findMany({
      where: { clientId },
      include: {
        accountManager: { select: { name: true } },
        campaigns: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Direct Mail
          <InfoTip>
            A program is one mail engagement for this client (e.g. New Movers). Each program contains monthly
            campaigns — one per physical mailing — moving through Planning → Creative → Review → Approval →
            Production → Mailed → Results.
          </InfoTip>
        </h2>
        {canManage ? (
          <NewProgramDialog
            clientId={clientId}
            teamMembers={teamMembers}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                New program
              </Button>
            }
          />
        ) : null}
      </div>

      <div className="mt-4">
        {programs.length === 0 ? (
          <div className="rounded-lg border">
            <EmptyState icon={Mail} title="No Direct Mail programs yet." className="py-6" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((program) => (
              <ProgramCard key={program.id} clientId={clientId} program={program} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
