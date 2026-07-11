"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";
import { clientSchema } from "@/lib/validations/client";

export type ClientFormState = { error: string | null };

export async function createClientAction(_prevState: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status"),
  });
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
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const before = await prisma.client.findUnique({ where: { id: clientId } });
  const client = await prisma.client.update({ where: { id: clientId }, data: parsed.data });

  if (before) {
    const changes: string[] = [];
    if (before.name !== client.name) changes.push(`renamed to "${client.name}"`);
    if (before.status !== client.status) changes.push(`status changed to ${client.status}`);
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
