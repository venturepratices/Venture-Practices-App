import Link from "next/link";
import { Pencil, Plus } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { TeamMemberFormDialog } from "@/components/team/team-member-form-dialog";
import { DeleteTeamMemberButton } from "@/components/team/delete-team-member-button";

export default async function TeamPage() {
  const members = await prisma.teamMember.findMany({
    select: { id: true, name: true, email: true, createdAt: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Team</h1>
          <p className="mt-1 text-muted-foreground">Add, edit, and manage team member accounts.</p>
        </div>
        <TeamMemberFormDialog
          mode="create"
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
              </div>
              <div className="flex items-center gap-1">
                <TeamMemberFormDialog
                  mode="edit"
                  memberId={member.id}
                  defaultName={member.name}
                  defaultEmail={member.email}
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
