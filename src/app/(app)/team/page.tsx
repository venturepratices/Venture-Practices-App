import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";

import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/info-tip";
import { TeamMemberFormDialog } from "@/components/team/team-member-form-dialog";
import { DeleteTeamMemberButton } from "@/components/team/delete-team-member-button";

function accessSummary(member: {
  isAdmin: boolean;
  allClientsAccess: boolean;
  canViewCredentials: boolean;
  canViewConversations: boolean;
  canViewActivityArchive: boolean;
  clientAccess: { clientId: string }[];
}): string {
  if (member.isAdmin) return "Admin · full access";
  const parts: string[] = [];
  parts.push(member.allClientsAccess ? "All clients" : `${member.clientAccess.length} client${member.clientAccess.length === 1 ? "" : "s"}`);
  const caps: string[] = [];
  if (member.canViewCredentials) caps.push("Credentials");
  if (member.canViewConversations) caps.push("Conversations");
  if (member.canViewActivityArchive) caps.push("Activity");
  if (caps.length) parts.push(caps.join(", "));
  return `Member · ${parts.join(" · ")}`;
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
        canViewCredentials: true,
        canViewConversations: true,
        canViewActivityArchive: true,
        clientAccess: { select: { clientId: true } },
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
              Everyone who can log in. Admins see and manage everything; members only see the clients and sensitive
              areas you grant them here.
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
          members.map((member) => (
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
                  defaultCanViewCredentials={member.canViewCredentials}
                  defaultCanViewConversations={member.canViewConversations}
                  defaultCanViewActivityArchive={member.canViewActivityArchive}
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
          ))
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
