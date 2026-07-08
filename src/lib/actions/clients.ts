"use server";

import { revalidatePath } from "next/cache";

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

  await prisma.client.create({ data: parsed.data });
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

  await prisma.client.update({ where: { id: clientId }, data: parsed.data });
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/", "layout");
  return { error: null };
}
