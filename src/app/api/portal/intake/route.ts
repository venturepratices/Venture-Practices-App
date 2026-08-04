import { NextResponse } from "next/server";

import { logActivity } from "@/lib/activity-log";
import { requireClientUserSession, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientIntakeSchema } from "@/lib/validations/client-intake";

export async function GET() {
  let clientUser;
  try {
    clientUser = await requireClientUserSession();
  } catch (error) {
    return toErrorResponse(error);
  }

  const [client, intake] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientUser.clientId },
      select: { contactName: true, contactEmail: true, contactPhone: true, website: true, about: true },
    }),
    prisma.clientIntake.findUnique({ where: { clientId: clientUser.clientId } }),
  ]);

  return NextResponse.json({ ...client, ...intake });
}

export async function PATCH(request: Request) {
  let clientUser;
  try {
    clientUser = await requireClientUserSession();
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = clientIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { contactName, contactEmail, contactPhone, website, about, ...intakeFields } = parsed.data;

  const [client, intake] = await prisma.$transaction([
    prisma.client.update({
      where: { id: clientUser.clientId },
      data: { contactName, contactEmail, contactPhone, website, about },
    }),
    prisma.clientIntake.upsert({
      where: { clientId: clientUser.clientId },
      create: { clientId: clientUser.clientId, ...intakeFields, submittedAt: new Date() },
      update: { ...intakeFields, submittedAt: new Date() },
    }),
  ]);

  await logActivity({
    actorId: null,
    actorName: clientUser.name,
    entityType: "Client",
    entityId: clientUser.clientId,
    entityLabel: client.name,
    clientId: clientUser.clientId,
    action: "intake_updated",
    description: `${clientUser.name ?? "The client"} updated business info for "${client.name}"`,
  });

  return NextResponse.json({ ...client, ...intake });
}
