"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { CAPABILITIES } from "@/lib/permission-catalog";
import { PermissionError, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createTeamMemberSchema, updateTeamMemberSchema } from "@/lib/validations/team-member";

export type TeamMemberFormState = { error: string | null };

// Managing team members (create/update/delete, resetting passwords, granting
// access) is admin-only. Returns the error to the form rather than throwing.
async function assertAdminOrError(): Promise<TeamMemberFormState | null> {
  try {
    await requireAdmin();
    return null;
  } catch (error) {
    if (error instanceof PermissionError) return { error: error.message };
    throw error;
  }
}

// The permission checklist fields, read straight off the form (checkboxes +
// the multi-valued client list) rather than through zod. Every capability in
// CAPABILITIES (the same catalog the admin UI renders from) is read the same
// way, so a new capability added to the catalog is automatically persisted
// here with no extra wiring.
function readPermissionFields(formData: FormData) {
  const bool = (name: string) => {
    const v = formData.get(name);
    return v === "on" || v === "true";
  };
  return {
    isAdmin: bool("isAdmin"),
    allClientsAccess: bool("allClientsAccess"),
    clientIds: formData.getAll("clientIds").map(String).filter(Boolean),
    caps: Object.fromEntries(CAPABILITIES.map((cap) => [cap, bool(cap)])) as Record<
      (typeof CAPABILITIES)[number],
      boolean
    >,
  };
}

export async function createTeamMemberAction(
  _prevState: TeamMemberFormState,
  formData: FormData
): Promise<TeamMemberFormState> {
  const denied = await assertAdminOrError();
  if (denied) return denied;

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

  const perms = readPermissionFields(formData);
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const member = await prisma.teamMember.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      isAdmin: perms.isAdmin,
      allClientsAccess: perms.allClientsAccess,
      ...perms.caps,
      clientAccess: perms.clientIds.length
        ? { create: perms.clientIds.map((clientId) => ({ clientId })) }
        : undefined,
    },
  });

  const session = await auth();
  await logActivity({
    actorId: session?.user?.id ?? null,
    actorName: session?.user?.name ?? null,
    entityType: "TeamMember",
    entityId: member.id,
    entityLabel: member.name,
    action: "created",
    description: `${session?.user?.name ?? "Someone"} added team member "${member.name}"${perms.isAdmin ? " (admin)" : ""}`,
  });

  revalidatePath("/team");
  revalidatePath("/", "layout");
  return { error: null };
}

export async function updateTeamMemberAction(
  memberId: string,
  _prevState: TeamMemberFormState,
  formData: FormData
): Promise<TeamMemberFormState> {
  const denied = await assertAdminOrError();
  if (denied) return denied;

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
  if (!before) {
    return { error: "That team member no longer exists." };
  }

  const perms = readPermissionFields(formData);

  // Last-admin safeguard: never let the only remaining admin be demoted, or
  // the whole team could be locked out of team/permission management.
  if (before.isAdmin && !perms.isAdmin) {
    const adminCount = await prisma.teamMember.count({ where: { isAdmin: true } });
    if (adminCount <= 1) {
      return { error: "This is the only admin — promote someone else to admin first." };
    }
  }

  const member = await prisma.teamMember.update({
    where: { id: memberId },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      isAdmin: perms.isAdmin,
      allClientsAccess: perms.allClientsAccess,
      ...perms.caps,
      // An admin setting someone else's password here is a recovery/temporary
      // password by definition — force them to set their own on next login.
      ...(parsed.data.password
        ? { passwordHash: await bcrypt.hash(parsed.data.password, 12), mustChangePassword: true }
        : {}),
      // Reconcile client-access grants: clear and re-create from the checklist.
      clientAccess: {
        deleteMany: {},
        create: perms.clientIds.map((clientId) => ({ clientId })),
      },
    },
  });

  const changes: string[] = [];
  if (before.name !== member.name) changes.push(`renamed to "${member.name}"`);
  if (before.email !== member.email) changes.push(`email changed to ${member.email}`);
  if (parsed.data.password) changes.push("password reset");
  if (before.isAdmin !== member.isAdmin) changes.push(member.isAdmin ? "made an admin" : "changed to member");
  // Access/capability changes are logged as a single catch-all so the audit
  // trail shows *that* access changed without spelling out every flag.
  const accessChanged =
    before.allClientsAccess !== member.allClientsAccess ||
    CAPABILITIES.some((cap) => before[cap] !== member[cap]);
  if (accessChanged) changes.push("access updated");
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

  revalidatePath("/team");
  revalidatePath("/", "layout");
  return { error: null };
}

export async function deleteTeamMemberAction(memberId: string) {
  await requireAdmin();

  const member = await prisma.teamMember.findUnique({ where: { id: memberId } });
  if (!member) return;

  // Last-admin safeguard also applies to deletion.
  if (member.isAdmin) {
    const adminCount = await prisma.teamMember.count({ where: { isAdmin: true } });
    if (adminCount <= 1) {
      throw new PermissionError(400, "This is the only admin — promote someone else before removing them.");
    }
  }

  await prisma.teamMember.delete({ where: { id: memberId } });

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

  revalidatePath("/team");
  revalidatePath("/", "layout");
}
