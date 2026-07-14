"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { PermissionError, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientSchema } from "@/lib/validations/client";

export type ClientFormState = { error: string | null };

// Creating/renaming/deleting a client is a structural change — admins only.
// Members work *within* the clients they're granted; they don't manage the
// client roster. Returns the error to the form rather than throwing.
async function assertAdminOrError(): Promise<ClientFormState | null> {
  try {
    await requireAdmin();
    return null;
  } catch (error) {
    if (error instanceof PermissionError) return { error: error.message };
    throw error;
  }
}

function readClientFormData(formData: FormData) {
  return {
    name: formData.get("name"),
    status: formData.get("status"),
    contactName: formData.get("contactName"),
    contactEmail: formData.get("contactEmail"),
    contactPhone: formData.get("contactPhone"),
    website: formData.get("website"),
    address: formData.get("address"),
    about: formData.get("about"),
  };
}

export async function createClientAction(_prevState: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const denied = await assertAdminOrError();
  if (denied) return denied;

  const parsed = clientSchema.safeParse(readClientFormData(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const client = await prisma.client.create({ data: parsed.data });

  const session = await auth();
  await logActivity({
    actorId: session?.user?.id ?? null,
    actorName: session?.user?.name ?? null,
    entityType: "Client",
    entityId: client.id,
    entityLabel: client.name,
    action: "created",
    description: `${session?.user?.name ?? "Someone"} added client "${client.name}"`,
  });

  revalidatePath("/clients");
  revalidatePath("/", "layout");
  return { error: null };
}

export async function updateClientAction(clientId: string, _prevState: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const denied = await assertAdminOrError();
  if (denied) return denied;

  const parsed = clientSchema.safeParse(readClientFormData(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const before = await prisma.client.findUnique({ where: { id: clientId } });
  const client = await prisma.client.update({ where: { id: clientId }, data: parsed.data });

  if (before) {
    const changes: string[] = [];
    if (before.name !== client.name) changes.push(`renamed to "${client.name}"`);
    if (before.status !== client.status) changes.push(`status changed to ${client.status}`);
    if (before.contactName !== client.contactName) changes.push("contact name updated");
    if (before.contactEmail !== client.contactEmail) changes.push("contact email updated");
    if (before.contactPhone !== client.contactPhone) changes.push("contact phone updated");
    if (before.website !== client.website) changes.push("website updated");
    if (before.address !== client.address) changes.push("address updated");
    if (before.about !== client.about) changes.push("about updated");
    if (changes.length > 0) {
      const session = await auth();
      await logActivity({
        actorId: session?.user?.id ?? null,
        actorName: session?.user?.name ?? null,
        entityType: "Client",
        entityId: client.id,
        entityLabel: client.name,
        action: "updated",
        description: `${session?.user?.name ?? "Someone"} updated client "${client.name}": ${changes.join(", ")}`,
      });
    }
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/", "layout");
  return { error: null };
}
