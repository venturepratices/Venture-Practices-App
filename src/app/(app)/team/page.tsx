import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";

import { CAPABILITIES, type Capability } from "@/lib/permission-catalog";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/info-tip";
import { TeamMemberFormDialog } from "@/components/team/team-member-form-dialog";
import { DeleteTeamMemberButton } from "@/components/team/delete-team-member-button";

type MemberRow = {
  isAdmin: boolean;
  allClientsAccess: boolean;
  clientAccess: { clientId: string }[];
} & Record<Capability, boolean>;

function accessSummary(member: MemberRow): string {
  if (member.isAdmin) return "Admin · full access";
  const clientsPart = member.allClientsAccess
    ? "All clients"
    : `${member.clientAccess.length} client${member.clientAccess.length === 1 ? "" : "s"}`;
  const enabledCount = CAPABILITIES.filter((cap) => member[cap]).length;
  return `Member · ${clientsPart} · ${enabledCount}/${CAPABILITIES.length} permissions`;
}

export default async function TeamPage() {
  // Managing the team is admin-only. Enforced fresh from the DB.
  if (!(await isAdmin())) notFound();

  const [members, clients] = await Promise.all([
    prisma.teamMember.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        isAdmin: true,
        allClientsAccess: true,
        clientAccess: { select: { clientId: true } },
        canCreateClients: true,
        canEditClients: true,
        canDeleteClients: true,
        canCreateTasks: true,
        canEditTasks: true,
        canDeleteTasks: true,
        canCommentOnTasks: true,
        canManageTaskLinks: true,
        canCreateClientNotes: true,
        canEditClientNotes: true,
        canDeleteClientNotes: true,
        canCreateMeetingNotes: true,
        canDeleteMeetingNotes: true,
        canManageClientLinks: true,
        canViewCredentials: true,
        canManageCredentials: true,
        canRevealCredentials: true,
        canViewConversations: true,
        canManageHighLevel: true,
        canViewActivity: true,
        canViewArchive: true,
        canRestoreArchive: true,
        canViewAssets: true,
        canUploadAssets: true,
        canCommentOnAssets: true,
        canDecideOnAssets: true,
        canManageAssetReviewers: true,
        canShareAssetsExternally: true,
        canDeleteAssets: true,
        canManageClientUsers: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Team
            <InfoTip>
              Everyone who can log in. Admins see and manage everything; members only see the clients and specific
              permissions you check for them here — nothing is granted automatically.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Add, edit, and manage team member accounts and access.</p>
        </div>
        <TeamMemberFormDialog
          mode="create"
          clients={clients}
          trigger={
            <Button>
              <Plus className="size-4" />
              New team member
            </Button>
          }
        />
      </div>

      <div className="mt-6 rounded-lg border divide-y">
        {members.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No team members yet.</p>
        ) : (
          members.map((member) => {
            const defaultCaps = Object.fromEntries(CAPABILITIES.map((cap) => [cap, member[cap]])) as Record<
              Capability,
              boolean
            >;
            return (
              <div key={member.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium">{member.name}</p>
                  <p className="text-sm text-muted-foreground">{member.email}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{accessSummary(member)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <TeamMemberFormDialog
                    mode="edit"
                    clients={clients}
                    memberId={member.id}
                    defaultName={member.name}
                    defaultEmail={member.email}
                    defaultIsAdmin={member.isAdmin}
                    defaultAllClientsAccess={member.allClientsAccess}
                    defaultCaps={defaultCaps}
                    defaultClientIds={member.clientAccess.map((c) => c.clientId)}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Edit ${member.name}`}>
                        <Pencil className="size-4" />
                      </Button>
                    }
                  />
                  <DeleteTeamMemberButton memberId={member.id} memberName={member.name} />
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="mt-6 text-sm">
        <Link href="/archive" className="text-primary underline-offset-4 hover:underline">
          View deleted tasks in the archive
        </Link>
      </p>
    </div>
  );
}
