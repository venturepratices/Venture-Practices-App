"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";

export type ChangePasswordState = { error: string | null };

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export async function changePasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in." };
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const member = await prisma.teamMember.findUnique({ where: { id: session.user.id } });
  if (!member) {
    return { error: "Account not found." };
  }

  const currentMatches = await bcrypt.compare(parsed.data.currentPassword, member.passwordHash);
  if (!currentMatches) {
    return { error: "Your current password isn't right." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.teamMember.update({
    where: { id: member.id },
    data: { passwordHash, mustChangePassword: false },
  });

  await logActivity({
    actorId: member.id,
    actorName: member.name,
    entityType: "TeamMember",
    entityId: member.id,
    entityLabel: member.name,
    action: "password_changed",
    description: `${member.name} changed their password`,
  });

  redirect("/dashboard");
}
