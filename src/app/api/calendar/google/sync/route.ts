import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { syncTeamMemberCalendar } from "@/lib/google-calendar";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncTeamMemberCalendar(session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Sync failed." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
