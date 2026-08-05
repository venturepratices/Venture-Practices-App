import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getAuthUrl, isGoogleCalendarConfigured } from "@/lib/google-calendar";

export const OAUTH_STATE_COOKIE = "gcal_oauth_state";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ error: "Google Calendar isn't configured yet." }, { status: 503 });
  }

  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(getAuthUrl(state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
