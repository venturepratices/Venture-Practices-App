import { CalendarDays } from "lucide-react";

import { auth } from "@/lib/auth";
import { isGoogleCalendarConfigured } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import { InfoTip } from "@/components/info-tip";
import { CalendarConnectionCard } from "@/components/settings/calendar-connection-card";

export default async function CalendarSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const connection = session?.user?.id
    ? await prisma.teamMemberCalendarConnection.findUnique({
        where: { teamMemberId: session.user.id },
        select: { googleEmail: true, connectedAt: true, lastSyncAt: true, lastSyncError: true },
      })
    : null;

  return (
    <div className="max-w-xl">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <CalendarDays className="size-6" />
        Google Calendar
        <InfoTip>
          Connect your own Google Calendar so the team can see when you&apos;re free or busy on{" "}
          <span className="font-medium">Team → Availability</span> — nobody sees your event titles, attendees, or
          locations, only whether a time slot is open.
        </InfoTip>
      </h1>
      <p className="mt-1 text-muted-foreground">
        Connect your own Google account. This is self-service — nobody else can connect it for you.
      </p>

      <div className="mt-6">
        <CalendarConnectionCard
          connection={connection}
          configured={isGoogleCalendarConfigured()}
          justConnected={params.connected === "1"}
          error={params.error}
        />
      </div>
    </div>
  );
}
