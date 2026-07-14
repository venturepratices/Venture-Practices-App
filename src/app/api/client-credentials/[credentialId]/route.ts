import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { encryptSecret } from "@/lib/credential-crypto";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const updateCredentialSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(120),
  url: z.string().trim().url("Enter a valid URL").optional().or(z.literal("")),
  username: z.string().trim().max(200).optional().or(z.literal("")),
  // Only present when rotating the stored password (e.g. the client changed
  // their real one) — omitted/blank means "keep the existing password".
  password: z.string().max(500).optional().or(z.literal("")),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ credentialId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { credentialId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateCredentialSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const existing = await prisma.clientCredential.findUnique({
    where: { id: credentialId },
    include: { client: { select: { name: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(existing.clientId);
    await requireCapability("credentials");
  } catch (error) {
    return toErrorResponse(error);
  }

  const credential = await prisma.clientCredential.update({
    where: { id: credentialId },
    data: {
      label: parsed.data.label,
      url: parsed.data.url || null,
      username: parsed.data.username || null,
      ...(parsed.data.password ? { encryptedPassword: encryptSecret(parsed.data.password) } : {}),
    },
    select: { id: true, clientId: true, label: true, url: true, username: true, createdAt: true, updatedAt: true },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: existing.clientId,
    entityLabel: existing.client.name,
    action: "credential_updated",
    description: `${session.user.name ?? "Someone"} updated the credential "${credential.label}" for "${existing.client.name}"${parsed.data.password ? " (password rotated)" : ""}`,
  });

  return NextResponse.json(credential);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ credentialId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { credentialId } = await params;
  const existing = await prisma.clientCredential.findUnique({
    where: { id: credentialId },
    include: { client: { select: { name: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(existing.clientId);
    await requireCapability("credentials");
  } catch (error) {
    return toErrorResponse(error);
  }

  await prisma.clientCredential.delete({ where: { id: credentialId } });

  if (existing) {
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "Client",
      entityId: existing.clientId,
      entityLabel: existing.client.name,
      action: "credential_removed",
      description: `${session.user.name ?? "Someone"} removed the credential "${existing.label}" from "${existing.client.name}"`,
    });
  }

  return NextResponse.json({ ok: true });
}
