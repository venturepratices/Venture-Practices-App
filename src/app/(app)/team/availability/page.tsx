import { CalendarClock, Link as LinkIcon, Users } from "lucide-react";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initialsOf, zonedDateTime } from "@/lib/utils";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPillBase } from "@/components/ui/status-pill";
import { AvailabilityFilters } from "@/components/team/availability-filters";

export default async function TeamAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; from?: string; to?: string; tz?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;

  const members = await prisma.teamMember.findMany({
    select: {
      id: true,
      name: true,
      calendarConnection: { select: { connectedAt: true } },
    },
    orderBy: { name: "asc" },
  });

  const hasWindow = !!(params.date && params.from && params.to);
  let busyMemberIds = new Set<string>();

  if (hasWindow) {
    const queryStart = zonedDateTime(params.date!, params.from!, params.tz);
    const queryEnd = zonedDateTime(params.date!, params.to!, params.tz);
    const overlapping = await prisma.teamMemberBusyBlock.findMany({
      where: { startTime: { lt: queryEnd }, endTime: { gt: queryStart } },
      select: { teamMemberId: true },
    });
    busyMemberIds = new Set(overlapping.map((b) => b.teamMemberId));
  }

  return (
    <div className="max-w-2xl">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <CalendarClock className="size-6" />
        Team Availability
        <InfoTip>
          Pick a date, time window, and timezone to see who on the team is free — the timezone defaults to yours,
          but change it if you're scheduling around someone else's zone. Only people who've connected their Google
          Calendar (Settings → Google Calendar) show as Available/Busy — everyone else shows as Not connected.
        </InfoTip>
      </h1>
      <p className="mt-1 text-muted-foreground">Find a time everyone's actually free — no more opening 5 calendars.</p>

      <div className="mt-6">
        <AvailabilityFilters />
      </div>

      <div className="mt-4 divide-y rounded-lg border">
        {members.length === 0 ? (
          <EmptyState icon={Users} title="No team members yet." />
        ) : (
          members.map((member) => {
            const connected = !!member.calendarConnection;
            const busy = connected && busyMemberIds.has(member.id);
            const isMe = member.id === session?.user?.id;

            let pill: { tone: "success" | "danger" | "neutral"; label: string };
            if (!hasWindow) {
              pill = { tone: "neutral", label: connected ? "Connected" : "Not connected" };
            } else if (!connected) {
              pill = { tone: "neutral", label: "Not connected" };
            } else if (busy) {
              pill = { tone: "danger", label: "Busy" };
            } else {
              pill = { tone: "success", label: "Available" };
            }

            return (
              <div key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                    {initialsOf(member.name)}
                  </div>
                  <p className="font-medium">
                    {member.name}
                    {isMe ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {isMe && !connected ? (
                    <Link
                      href="/settings/calendar"
                      className="flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                    >
                      <LinkIcon className="size-3" />
                      Connect
                    </Link>
                  ) : null}
                  <StatusPillBase tone={pill.tone} label={pill.label} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {!hasWindow ? (
        <p className="mt-4 text-sm text-muted-foreground">Pick a date and time range above to check availability.</p>
      ) : null}
    </div>
  );
}
