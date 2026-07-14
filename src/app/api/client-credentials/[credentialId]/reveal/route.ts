import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { decryptSecret } from "@/lib/credential-crypto";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const revealSchema = z.object({
  password: z.string().min(1, "Enter your password"),
});

/**
 * The gated reveal action: requires the caller's OWN account password, not
 * the stored credential's password. This is what makes "re-enter your own
 * password" a meaningful, traceable gate — every reveal (success or not) is
 * logged, so there's an audit trail of who looked at what and when.
 */
export async function POST(request: Request, { params }: { params: Promise<{ credentialId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { credentialId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = revealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const credential = await prisma.clientCredential.findUnique({
    where: { id: credentialId },
    include: { client: { select: { name: true } } },
  });
  if (!credential) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(credential.clientId);
    await requireCapability("credentials");
  } catch (error) {
    return toErrorResponse(error);
  }

  const me = await prisma.teamMember.findUnique({ where: { id: session.user.id } });
  const passwordMatches = me && (await bcrypt.compare(parsed.data.password, me.passwordHash));

  if (!passwordMatches) {
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "Client",
      entityId: credential.clientId,
      entityLabel: credential.client.name,
      action: "credential_reveal_denied",
      description: `${session.user.name ?? "Someone"} entered the wrong password trying to view the credential "${credential.label}" on "${credential.client.name}"`,
    });
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: credential.clientId,
    entityLabel: credential.client.name,
    action: "credential_revealed",
    description: `${session.user.name ?? "Someone"} viewed the password for "${credential.label}" on "${credential.client.name}"`,
  });

  return NextResponse.json({ password: decryptSecret(credential.encryptedPassword) });
}
