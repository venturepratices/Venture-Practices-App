import { notFound } from "next/navigation";
import Link from "next/link";
import { Lightbulb } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { NewPlanningItemForm } from "@/components/planning/new-planning-item-form";
import { PlanningItemRow } from "@/components/planning/planning-item-row";

type SearchParams = { view?: string };

export default async function PlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { clientId } = await params;
  const { view } = await searchParams;
  const showArchived = view === "archived";

  // Client-access is enforced by the layout; this adds the Planning capability.
  if (!(await canUseCapability("canViewPlanning"))) notFound();
  const canManage = await canUseCapability("canManagePlanning");

  const [items, teamMembers] = await Promise.all([
    prisma.planningItem.findMany({
      where: showArchived ? { clientId, status: { in: ["ARCHIVED", "CONVERTED"] } } : { clientId, status: { in: ["IDEA", "STRATEGY"] } },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Planning
          <InfoTip>
            A place to park half-formed ideas for this client, separate from real tasks. Move an idea to "Strategy"
            once it's more solid, "Move to task" once someone's ready to work on it (you'll pick who), or "Move to
            Archive" if it's not happening.
          </InfoTip>
        </h2>
        <Link
          href={showArchived ? `/clients/${clientId}/planning` : `/clients/${clientId}/planning?view=archived`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {showArchived ? "Back to active ideas" : "Archived / converted"}
        </Link>
      </div>

      {canManage && !showArchived ? (
        <div className="mt-4">
          <NewPlanningItemForm clientId={clientId} />
        </div>
      ) : null}

      <div className="mt-4 rounded-lg border divide-y">
        {items.length === 0 ? (
          <EmptyState icon={Lightbulb} title={showArchived ? "Nothing archived or converted yet." : "No ideas yet — add one above."} />
        ) : (
          items.map((item) => <PlanningItemRow key={item.id} clientId={clientId} item={item} teamMembers={teamMembers} canManage={canManage} />)
        )}
      </div>
    </div>
  );
}
