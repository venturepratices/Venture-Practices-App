"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

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
  await prisma.teamMember.create({
    data: { name: parsed.data.name, email: parsed.data.email, passwordHash },
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

  await prisma.teamMember.update({
    where: { id: memberId },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      ...(parsed.data.password ? { passwordHash: await bcrypt.hash(parsed.data.password, 12) } : {}),
    },
  });

  revalidatePath("/team");
  return { error: null };
}

export async function deleteTeamMemberAction(memberId: string) {
  await prisma.teamMember.delete({ where: { id: memberId } });
  revalidatePath("/team");
}
