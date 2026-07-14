import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { encryptSecret } from "@/lib/credential-crypto";
import { prisma } from "@/lib/prisma";

const createCredentialSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(120),
  url: z.string().trim().url("Enter a valid URL").optional().or(z.literal("")),
  username: z.string().trim().max(200).optional().or(z.literal("")),
  password: z.string().min(1, "Password is required").max(500),
});

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = createCredentialSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const credential = await prisma.clientCredential.create({
    data: {
      clientId,
      label: parsed.data.label,
      url: parsed.data.url || null,
      username: parsed.data.username || null,
      encryptedPassword: encryptSecret(parsed.data.password),
    },
    select: { id: true, clientId: true, label: true, url: true, username: true, createdAt: true, updatedAt: true },
  });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: clientId,
    entityLabel: client?.name ?? clientId,
    action: "credential_added",
    description: `${session.user.name ?? "Someone"} added a credential ("${parsed.data.label}") for "${client?.name ?? "a client"}"`,
  });

  return NextResponse.json(credential, { status: 201 });
}
