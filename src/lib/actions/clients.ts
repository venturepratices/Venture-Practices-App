"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { isAdmin, PermissionError, requireCapability, requireClientAccess, type Capability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ensureClientChannel } from "@/lib/slack";
import { SLACK_CHANNEL_ID_PATTERN } from "@/lib/slack-ids";
import { clientSchema } from "@/lib/validations/client";

export type ClientFormState = { error: string | null };

// Old audit #14: a client's Slack channel decides where that client's team
// posts go and who the channel sync invites or removes, so only an admin can
// set or change it, and only to something shaped like a channel ID that no
// other client (nor the team's general channel) uses. Callers run this only
// when the value is actually changing, so editors can keep saving clients
// they didn't touch the channel on, including older stored values. The
// automatic channel for a new client is written by ensureClientChannel(),
// not through here. Returns the error to show, or null when allowed.
async function slackChannelChangeError(slackChannelId: string | null, clientId?: string): Promise<string | null> {
  if (!(await isAdmin())) {
    return "Only an admin can set or change a client's Slack channel. Ask an admin to do it for you.";
  }
  if (slackChannelId === null) return null;
  if (!SLACK_CHANNEL_ID_PATTERN.test(slackChannelId)) {
    return "That isn't a Slack channel ID. Channel IDs start with C or G, like C0123ABCD45.";
  }
  if (slackChannelId === process.env.SLACK_INTERNAL_CHANNEL_ID) {
    return "That is the team's general Slack channel. A client needs its own channel.";
  }
  const usedBy = await prisma.client.findFirst({
    where: clientId ? { slackChannelId, NOT: { id: clientId } } : { slackChannelId },
    select: { id: true },
  });
  if (usedBy) return "That Slack channel is already used by another client. Each client needs its own channel.";
  return null;
}

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

  if (parsed.data.slackChannelId !== null) {
    const channelError = await slackChannelChangeError(parsed.data.slackChannelId);
    if (channelError) return { error: channelError };
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
  if (parsed.data.slackChannelId !== (before?.slackChannelId ?? null)) {
    const channelError = await slackChannelChangeError(parsed.data.slackChannelId, clientId);
    if (channelError) return { error: channelError };
  }

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
