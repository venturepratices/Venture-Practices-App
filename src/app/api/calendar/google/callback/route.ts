import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { encryptSecret } from "@/lib/credential-crypto";
import { logActivity } from "@/lib/activity-log";
import { exchangeCodeForTokens, syncTeamMemberCalendar } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import { OAUTH_STATE_COOKIE } from "@/app/api/calendar/google/connect/route";

function redirectToSettings(request: Request, params: Record<string, string>) {
  const url = new URL("/settings/calendar", request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const cookieState = request.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.split("=")[1];

  if (errorParam) {
    return redirectToSettings(request, { error: "Google sign-in was cancelled or denied." });
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectToSettings(request, { error: "This connection attempt could not be verified. Try again." });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await prisma.teamMemberCalendarConnection.upsert({
      where: { teamMemberId: session.user.id },
      create: {
        teamMemberId: session.user.id,
        encryptedAccessToken: encryptSecret(tokens.accessToken),
        encryptedRefreshToken: encryptSecret(tokens.refreshToken),
        accessTokenExpiresAt: tokens.expiryDate,
      },
      update: {
        encryptedAccessToken: encryptSecret(tokens.accessToken),
        encryptedRefreshToken: encryptSecret(tokens.refreshToken),
        accessTokenExpiresAt: tokens.expiryDate,
        lastSyncError: null,
      },
    });

    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? "Someone",
      entityType: "TeamMember",
      entityId: session.user.id,
      entityLabel: session.user.name ?? "Team member",
      action: "calendar_connected",
      description: `${session.user.name ?? "Someone"} connected their Google Calendar`,
    });

    await syncTeamMemberCalendar(session.user.id);

    const res = redirectToSettings(request, { connected: "1" });
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to connect Google Calendar.";
    return redirectToSettings(request, { error: message });
  }
}
