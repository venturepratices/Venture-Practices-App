import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notificationPreferencesSchema } from "@/lib/validations/notification-preferences";

/**
 * Self-service — a person's own notification preferences. No admin/capability
 * gate: everyone can always control what THEY get notified about, same as
 * change-password or the Google Calendar connection.
 */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = notificationPreferencesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preferences" }, { status: 400 });
  }

  await prisma.teamMember.update({
    where: { id: session.user.id },
    data: { notificationPreferences: parsed.data },
  });

  return NextResponse.json({ ok: true });
}
