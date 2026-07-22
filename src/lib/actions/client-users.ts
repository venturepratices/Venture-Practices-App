"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { PermissionError, requireCapability, requireClientAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createClientUserSchema, updateClientUserSchema } from "@/lib/validations/client-user";

export type ClientUserFormState = { error: string | null };

// Creating a real login for a client contact is sensitive enough to warrant
// its own capability (canManageClientUsers) — separate from the more routine
// asset capabilities. Also requires access to the specific client the account
// belongs to, same as every other per-client mutation in this app.
async function assertCanManage(clientId: string): Promise<ClientUserFormState | null> {
  try {
    await requireClientAccess(clientId);
    await requireCapability("canManageClientUsers");
    return null;
  } catch (error) {
    if (error instanceof PermissionError) return { error: error.message };
    throw error;
  }
}

export async function createClientUserAction(
  clientId: string,
  _prevState: ClientUserFormState,
  formData: FormData
): Promise<ClientUserFormState> {
  const denied = await assertCanManage(clientId);
  if (denied) return denied;

  const parsed = createClientUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await prisma.clientUser.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { error: "A client login with that email already exists." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const clientUser = await prisma.clientUser.create({
    data: { clientId, name: parsed.data.name, email: parsed.data.email, passwordHash },
  });

  const session = await auth();
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session?.user?.id ?? null,
    actorName: session?.user?.name ?? null,
    entityType: "ClientUser",
    entityId: clientUser.id,
    entityLabel: clientUser.name,
    action: "created",
    description: `${session?.user?.name ?? "Someone"} created a login for "${clientUser.name}" on ${client?.name ?? "a client"}`,
  });

  revalidatePath(`/clients/${clientId}`);
  return { error: null };
}

export async function updateClientUserAction(
  clientUserId: string,
  _prevState: ClientUserFormState,
  formData: FormData
): Promise<ClientUserFormState> {
  const before = await prisma.clientUser.findUnique({ where: { id: clientUserId } });
  if (!before) return { error: "That client login no longer exists." };

  const denied = await assertCanManage(before.clientId);
  if (denied) return denied;

  const parsed = updateClientUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await prisma.clientUser.findFirst({
    where: { email: parsed.data.email, NOT: { id: clientUserId } },
  });
  if (existing) {
    return { error: "A client login with that email already exists." };
  }

  const clientUser = await prisma.clientUser.update({
    where: { id: clientUserId },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      // Same convention as team members: an admin setting a new password here
      // is a recovery/temporary password by definition — force a self-service
      // change on next login.
      ...(parsed.data.password
        ? { passwordHash: await bcrypt.hash(parsed.data.password, 12), mustChangePassword: true }
        : {}),
    },
  });

  const changes: string[] = [];
  if (before.name !== clientUser.name) changes.push(`renamed to "${clientUser.name}"`);
  if (before.email !== clientUser.email) changes.push(`email changed to ${clientUser.email}`);
  if (parsed.data.password) changes.push("password reset");
  if (changes.length > 0) {
    const session = await auth();
    await logActivity({
      actorId: session?.user?.id ?? null,
      actorName: session?.user?.name ?? null,
      entityType: "ClientUser",
      entityId: clientUser.id,
      entityLabel: clientUser.name,
      action: "updated",
      description: `${session?.user?.name ?? "Someone"} updated client login "${clientUser.name}": ${changes.join(", ")}`,
    });
  }

  revalidatePath(`/clients/${before.clientId}`);
  return { error: null };
}

export async function deleteClientUserAction(clientUserId: string) {
  const clientUser = await prisma.clientUser.findUnique({ where: { id: clientUserId } });
  if (!clientUser) return;

  await requireClientAccess(clientUser.clientId);
  await requireCapability("canManageClientUsers");

  await prisma.clientUser.delete({ where: { id: clientUserId } });

  const session = await auth();
  await logActivity({
    actorId: session?.user?.id ?? null,
    actorName: session?.user?.name ?? null,
    entityType: "ClientUser",
    entityId: clientUserId,
    entityLabel: clientUser.name,
    action: "deleted",
    description: `${session?.user?.name ?? "Someone"} removed client login "${clientUser.name}"`,
  });

  revalidatePath(`/clients/${clientUser.clientId}`);
}
