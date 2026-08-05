import { google } from "googleapis";

import { decryptSecret, encryptSecret } from "@/lib/credential-crypto";
import { prisma } from "@/lib/prisma";

/**
 * Self-service Google Calendar connection (Team Availability feature). Each
 * TeamMember connects their own Google account at /settings/calendar — this
 * is deliberately narrow-scoped to `calendar.freebusy` only, so the app can
 * never see event titles/attendees/locations, only whether a time is free or
 * busy. Tokens are encrypted at rest via credential-crypto.ts, same as the
 * Client Credentials vault.
 */

const SCOPES = ["https://www.googleapis.com/auth/calendar.freebusy"];
const BUSY_WINDOW_DAYS = 30;

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/calendar/google/callback`;
}

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET are not set.");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri());
}

export function isGoogleCalendarConfigured(): boolean {
  return !!(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
}

/** Builds the Google consent-screen URL. `state` should be a CSRF nonce set on a short-lived cookie by the caller. */
export function getAuthUrl(state: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a fresh refresh_token on every (re)connect, not just the first ever grant
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
    throw new Error(
      "Google did not return a refresh token. This can happen on a repeat connect without revoking prior access first — try disconnecting the app at https://myaccount.google.com/permissions and reconnecting.",
    );
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: new Date(tokens.expiry_date),
  };
}

async function getAuthenticatedClient(connection: { encryptedAccessToken: string; encryptedRefreshToken: string; accessTokenExpiresAt: Date; teamMemberId: string }) {
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: decryptSecret(connection.encryptedAccessToken),
    refresh_token: decryptSecret(connection.encryptedRefreshToken),
    expiry_date: connection.accessTokenExpiresAt.getTime(),
  });

  // Refresh proactively if within 5 minutes of expiry — googleapis can also
  // refresh lazily on-demand, but doing it here lets us persist the new
  // token immediately rather than losing it at the end of the process.
  if (connection.accessTokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
    const { credentials } = await client.refreshAccessToken();
    if (credentials.access_token && credentials.expiry_date) {
      await prisma.teamMemberCalendarConnection.update({
        where: { teamMemberId: connection.teamMemberId },
        data: {
          encryptedAccessToken: encryptSecret(credentials.access_token),
          accessTokenExpiresAt: new Date(credentials.expiry_date),
        },
      });
      client.setCredentials(credentials);
    }
  }

  return client;
}

/**
 * Refreshes this member's busy blocks for a rolling ~30-day window
 * (today..+30 days) via a single freebusy.query call, full-replacing their
 * TeamMemberBusyBlock rows. Never throws — sync failures are recorded on
 * lastSyncError so the UI can surface them without breaking the caller
 * (sync-on-view, the "Sync now" button, and the daily cron all share this).
 */
export async function syncTeamMemberCalendar(teamMemberId: string): Promise<{ ok: boolean; error?: string }> {
  const connection = await prisma.teamMemberCalendarConnection.findUnique({ where: { teamMemberId } });
  if (!connection) return { ok: false, error: "Not connected." };

  try {
    const client = await getAuthenticatedClient(connection);
    const calendar = google.calendar({ version: "v3", auth: client });

    const timeMin = new Date();
    const timeMax = new Date(Date.now() + BUSY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: connection.calendarId }],
      },
    });

    const busy = response.data.calendars?.[connection.calendarId]?.busy ?? [];
    const errors = response.data.calendars?.[connection.calendarId]?.errors;
    if (errors && errors.length > 0) {
      throw new Error(errors.map((e) => e.reason).join(", "));
    }

    await prisma.$transaction([
      prisma.teamMemberBusyBlock.deleteMany({ where: { teamMemberId } }),
      prisma.teamMemberBusyBlock.createMany({
        data: busy
          .filter((b): b is { start: string; end: string } => !!b.start && !!b.end)
          .map((b) => ({ teamMemberId, startTime: new Date(b.start), endTime: new Date(b.end) })),
      }),
      prisma.teamMemberCalendarConnection.update({
        where: { teamMemberId },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      }),
    ]);

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error.";
    await prisma.teamMemberCalendarConnection.update({
      where: { teamMemberId },
      data: { lastSyncError: message },
    });
    return { ok: false, error: message };
  }
}
