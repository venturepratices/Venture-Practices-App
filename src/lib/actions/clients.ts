"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { PermissionError, requireCapability, requireClientAccess, type Capability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ensureClientChannel } from "@/lib/slack";
import { clientSchema } from "@/lib/validations/client";

export type ClientFormState = { error: string | null };

// Returns the error to the form rather than throwing.
async function assertCapabilityOrError(cap: Capability, clientId?: string): Promise<ClientFormState | null> {
  try {
    await requireCapability(cap);
    if (clientId) await requireClientAccess(clientId);
    return null;
  } catch (error) {
    if (error instanceof PermissionError) return { error: error.message };
    throw error;
  }
}

// FormData.get() returns null for a field that isn't present in the DOM at
// submit time (e.g. the collapsed "secondary contact" inputs) — Zod's
// .optional() only accepts undefined, not null, so every optional field is
// normalized here to avoid a false "expected string, received null" error.
function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function readClientFormData(formData: FormData) {
  return {
    name: text(formData, "name"),
    status: text(formData, "status"),
    contactName: text(formData, "contactName"),
    contactEmail: text(formData, "contactEmail"),
    contactPhone: text(formData, "contactPhone"),
    secondaryContactName: text(formData, "secondaryContactName"),
    secondaryContactEmail: text(formData, "secondaryContactEmail"),
    secondaryContactPhone: text(formData, "secondaryContactPhone"),
    website: text(formData, "website"),
    address: text(formData, "address"),
    about: text(formData, "about"),
    source: text(formData, "source"),
    slackChannelId: text(formData, "slackChannelId"),
  };
}

export async function createClientAction(_prevState: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const denied = await assertCapabilityOrError("canCreateClients");
  if (denied) return denied;

  const parsed = clientSchema.safeParse(readClientFormData(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const client = await prisma.client.create({ data: parsed.data });
  await ensureClientChannel(client);

  const session = await auth();
  await logActivity({
    actorId: session?.user?.id ?? null,
    actorName: session?.user?.name ?? null,
    entityType: "Client",
    entityId: client.id,
    entityLabel: client.name,
    clientId: client.id,
    action: "created",
    description: `${session?.user?.name ?? "Someone"} added client "${client.name}"`,
  });

  revalidatePath("/clients");
  revalidatePath("/", "layout");
  return { error: null };
}

export async function updateClientAction(clientId: string, _prevState: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const denied = await assertCapabilityOrError("canEditClients", clientId);
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
    if (before.secondaryContactName !== client.secondaryContactName) changes.push("secondary contact name updated");
    if (before.secondaryContactEmail !== client.secondaryContactEmail) changes.push("secondary contact email updated");
    if (before.secondaryContactPhone !== client.secondaryContactPhone) changes.push("secondary contact phone updated");
    if (before.website !== client.website) changes.push("website updated");
    if (before.address !== client.address) changes.push("address updated");
    if (before.about !== client.about) changes.push("about updated");
    if (before.source !== client.source) changes.push("source updated");
    if (changes.length > 0) {
      const session = await auth();
      await logActivity({
        actorId: session?.user?.id ?? null,
        actorName: session?.user?.name ?? null,
        entityType: "Client",
        entityId: client.id,
        entityLabel: client.name,
        clientId: client.id,
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
