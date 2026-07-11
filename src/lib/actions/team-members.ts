"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";
import { createTeamMemberSchema, updateTeamMemberSchema } from "@/lib/validations/team-member";

export type TeamMemberFormState = { error: string | null };

export async function createTeamMemberAction(
  _prevState: TeamMemberFormState,
  formData: FormData
): Promise<TeamMemberFormState> {
  const parsed = createTeamMemberSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await prisma.teamMember.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { error: "A team member with that email already exists." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const member = await prisma.teamMember.create({
    data: { name: parsed.data.name, email: parsed.data.email, passwordHash },
  });

  const session = await auth();
  await logActivity({
    actorId: session?.user?.id ?? null,
    actorName: session?.user?.name ?? null,
    entityType: "TeamMember",
    entityId: member.id,
    entityLabel: member.name,
    action: "created",
    description: `${session?.user?.name ?? "Someone"} added team member "${member.name}"`,
  });

  revalidatePath("/team");
  return { error: null };
}

export async function updateTeamMemberAction(
  memberId: string,
  _prevState: TeamMemberFormState,
  formData: FormData
): Promise<TeamMemberFormState> {
  const parsed = updateTeamMemberSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await prisma.teamMember.findFirst({
    where: { email: parsed.data.email, NOT: { id: memberId } },
  });
  if (existing) {
    return { error: "A team member with that email already exists." };
  }

  const before = await prisma.teamMember.findUnique({ where: { id: memberId } });
  const member = await prisma.teamMember.update({
    where: { id: memberId },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      ...(parsed.data.password ? { passwordHash: await bcrypt.hash(parsed.data.password, 12) } : {}),
    },
  });

  if (before) {
    const changes: string[] = [];
    if (before.name !== member.name) changes.push(`renamed to "${member.name}"`);
    if (before.email !== member.email) changes.push(`email changed to ${member.email}`);
    if (parsed.data.password) changes.push("password reset");
    if (changes.length > 0) {
      const session = await auth();
      await logActivity({
        actorId: session?.user?.id ?? null,
        actorName: session?.user?.name ?? null,
        entityType: "TeamMember",
        entityId: member.id,
        entityLabel: member.name,
        action: "updated",
        description: `${session?.user?.name ?? "Someone"} updated team member "${member.name}": ${changes.join(", ")}`,
      });
    }
  }

  revalidatePath("/team");
  return { error: null };
}

export async function deleteTeamMemberAction(memberId: string) {
  const member = await prisma.teamMember.findUnique({ where: { id: memberId } });
  await prisma.teamMember.delete({ where: { id: memberId } });

  if (member) {
    const session = await auth();
    await logActivity({
      actorId: session?.user?.id ?? null,
      actorName: session?.user?.name ?? null,
      entityType: "TeamMember",
      entityId: memberId,
      entityLabel: member.name,
      action: "deleted",
      description: `${session?.user?.name ?? "Someone"} removed team member "${member.name}"`,
    });
  }

  revalidatePath("/team");
}
