import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { encryptSecret } from "@/lib/credential-crypto";
import { prisma } from "@/lib/prisma";
import { syncClientConversations, verifyHighLevelConnection } from "@/lib/highlevel";

export const runtime = "nodejs";

const connectSchema = z.object({
  locationId: z.string().trim().min(1, "Location ID is required").max(200),
  token: z.string().trim().min(1, "Private Integration Token is required").max(2000),
});

// Connect (or reconnect) a client to its HighLevel sub-account.
export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  // Validate the token BEFORE persisting so we never store a broken connection.
  try {
    await verifyHighLevelConnection(parsed.data.locationId, parsed.data.token);
  } catch (error) {
    console.error("HighLevel connect verification failed:", error);
    return NextResponse.json(
      {
        error: "Couldn't reach HighLevel with that Location ID and token. Double-check both and that the token has Conversations access.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }

  let encryptedToken: string;
  try {
    encryptedToken = encryptSecret(parsed.data.token);
  } catch (error) {
    console.error("HighLevel token encryption failed:", error);
    return NextResponse.json(
      {
        error: "The server isn't configured to store credentials yet (missing encryption key). Ask an admin to set CREDENTIALS_ENCRYPTION_KEY.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }

  await prisma.clientHighLevelConnection.upsert({
    where: { clientId },
    create: {
      clientId,
      locationId: parsed.data.locationId,
      encryptedToken,
      webhookSecret: randomBytes(24).toString("hex"),
    },
    update: {
      locationId: parsed.data.locationId,
      encryptedToken,
    },
  });

  // Backfill so the tab isn't empty. Best-effort — the token already validated,
  // so a failure here shouldn't undo the (valid) connection.
  try {
    await syncClientConversations(clientId, { force: true });
  } catch (error) {
    console.warn("HighLevel backfill after connect failed:", error);
  }

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: clientId,
    entityLabel: client?.name ?? clientId,
    action: "highlevel_connected",
    description: `${session.user.name ?? "Someone"} connected HighLevel for "${client?.name ?? "a client"}"`,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

// Disconnect — removes the stored token and the cached messages for this client.
export async function DELETE(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  const existing = await prisma.clientHighLevelConnection.findUnique({ where: { clientId } });
  if (!existing) {
    return NextResponse.json({ ok: true });
  }

  // Cached messages are just a mirror of HighLevel — safe to drop on disconnect.
  await prisma.conversationMessage.deleteMany({ where: { clientId } });
  await prisma.clientHighLevelConnection.delete({ where: { clientId } });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: clientId,
    entityLabel: client?.name ?? clientId,
    action: "highlevel_disconnected",
    description: `${session.user.name ?? "Someone"} disconnected HighLevel for "${client?.name ?? "a client"}"`,
  });

  return NextResponse.json({ ok: true });
}
