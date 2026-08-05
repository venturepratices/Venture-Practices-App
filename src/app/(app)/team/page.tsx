import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Pencil, Plus, Users } from "lucide-react";

import { auth } from "@/lib/auth";
import { computeFreeSlots, dayBoundsInTz, formatTimeInTz, type Interval } from "@/lib/availability";
import { syncTeamMemberCalendar } from "@/lib/google-calendar";
import { CAPABILITIES, type Capability } from "@/lib/permission-catalog";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { initialsOf, zonedDateTime } from "@/lib/utils";
import { InfoTip } from "@/components/info-tip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPillBase } from "@/components/ui/status-pill";
import { TeamMemberFormDialog } from "@/components/team/team-member-form-dialog";
import { DeleteTeamMemberButton } from "@/components/team/delete-team-member-button";
import { AvailabilityFilters } from "@/components/team/availability-filters";
import { AvailabilityDayTimeline } from "@/components/team/availability-day-timeline";
import { MemberFilter } from "@/components/team/member-filter";

type MemberRow = {
  isAdmin: boolean;
  allClientsAccess: boolean;
  clientAccess: { clientId: string }[];
} & Record<Capability, boolean>;

function accessSummary(member: MemberRow): string {
  if (member.isAdmin) return "Admin · full access";
  const clientsPart = member.allClientsAccess
    ? "All clients"
    : `${member.clientAccess.length} client${member.clientAccess.length === 1 ? "" : "s"}`;
  const enabledCount = CAPABILITIES.filter((cap) => member[cap]).length;
  return `Member · ${clientsPart} · ${enabledCount}/${CAPABILITIES.length} permissions`;
}

function accessRatio(member: MemberRow): number {
  if (member.isAdmin) return 1;
  return CAPABILITIES.filter((cap) => member[cap]).length / CAPABILITIES.length;
}

function hhmmInTz(date: Date, timeZone: string): string {
  return date.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; date?: string; from?: string; to?: string; tz?: string; members?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const admin = await isAdmin();
  const tab = admin && params.tab === "availability" ? "availability" : admin ? "members" : "availability";

  if (tab === "members" && !admin) notFound();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Team
          <InfoTip>
            {admin
              ? "Manage who can log in and what they can access, or check who's free right now."
              : "See when your teammates are free — connect your own Google Calendar to be included."}
          </InfoTip>
        </h1>
      </div>

      {admin ? (
        <div className="mt-4 flex gap-1 border-b">
          <Link
            href="/team?tab=members"
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === "members" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            Members
          </Link>
          <Link
            href="/team?tab=availability"
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === "availability" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            Availability
          </Link>
        </div>
      ) : null}

      {tab === "members" ? <MembersTab /> : <AvailabilityTab params={params} currentUserId={session?.user?.id ?? null} />}
    </div>
  );
}

async function MembersTab() {
  const [members, clients] = await Promise.all([
    prisma.teamMember.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        slackUserId: true,
        createdAt: true,
        isAdmin: true,
        allClientsAccess: true,
        clientAccess: { select: { clientId: true } },
        canCreateClients: true,
        canEditClients: true,
        canDeleteClients: true,
        canCreateTasks: true,
        canEditTasks: true,
        canDeleteTasks: true,
        canCommentOnTasks: true,
        canManageTaskLinks: true,
        canCreateClientNotes: true,
        canEditClientNotes: true,
        canDeleteClientNotes: true,
        canCreateMeetingNotes: true,
        canDeleteMeetingNotes: true,
        canManageClientLinks: true,
        canViewCredentials: true,
        canManageCredentials: true,
        canRevealCredentials: true,
        canViewConversations: true,
        canManageHighLevel: true,
        canViewActivity: true,
        canViewArchive: true,
        canRestoreArchive: true,
        canViewAssets: true,
        canUploadAssets: true,
        canCommentOnAssets: true,
        canDecideOnAssets: true,
        canManageAssetReviewers: true,
        canShareAssetsExternally: true,
        canDeleteAssets: true,
        canManageClientUsers: true,
        canViewDirectMail: true,
        canManageDirectMail: true,
        canViewWorkflows: true,
        canManageWorkflows: true,
        canViewPlanning: true,
        canManagePlanning: true,
        canViewOrders: true,
        canManageOrders: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <div className="mt-4 flex items-center justify-between">
        <p className="text-muted-foreground">Add, edit, and manage team member accounts and access.</p>
        <TeamMemberFormDialog
          mode="create"
          clients={clients}
          trigger={
            <Button>
              <Plus className="size-4" />
              New team member
            </Button>
          }
        />
      </div>

      <div className="mt-4 rounded-lg border divide-y">
        {members.length === 0 ? (
          <EmptyState icon={Users} title="No team members yet." />
        ) : (
          members.map((member) => {
            const defaultCaps = Object.fromEntries(CAPABILITIES.map((cap) => [cap, member[cap]])) as Record<
              Capability,
              boolean
            >;
            return (
              <div key={member.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                    {initialsOf(member.name)}
                  </div>
                  <div>
                    <p className="font-medium">{member.name}</p>
                    <p className="text-sm text-muted-foreground">{member.email}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">{accessSummary(member)}</p>
                      <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${accessRatio(member) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <TeamMemberFormDialog
                    mode="edit"
                    clients={clients}
                    memberId={member.id}
                    defaultName={member.name}
                    defaultEmail={member.email}
                    defaultSlackUserId={member.slackUserId}
                    defaultIsAdmin={member.isAdmin}
                    defaultAllClientsAccess={member.allClientsAccess}
                    defaultCaps={defaultCaps}
                    defaultClientIds={member.clientAccess.map((c) => c.clientId)}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Edit ${member.name}`}>
                        <Pencil className="size-4" />
                      </Button>
                    }
                  />
                  <DeleteTeamMemberButton memberId={member.id} memberName={member.name} />
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="mt-6 text-sm">
        <Link href="/archive" className="text-primary underline-offset-4 hover:underline">
          View deleted tasks in the archive
        </Link>
      </p>
    </div>
  );
}

async function AvailabilityTab({
  params,
  currentUserId,
}: {
  params: { date?: string; from?: string; to?: string; tz?: string; members?: string };
  currentUserId: string | null;
}) {
  const members = await prisma.teamMember.findMany({
    select: { id: true, name: true, calendarConnection: { select: { connectedAt: true, lastSyncAt: true } } },
    orderBy: { name: "asc" },
  });

  // Sync-on-view, throttled — whoever opens this tab triggers a refresh for
  // any connection that hasn't synced in the last minute, so the data stays
  // current without hammering Google on every render. The daily cron in
  // src/app/api/cron/calendar-sync/route.ts is the belt-and-suspenders sweep
  // for connections nobody happens to view.
  const SYNC_THROTTLE_MS = 60_000;
  const now = Date.now();
  const staleMemberIds = members
    .filter((m) => m.calendarConnection && (!m.calendarConnection.lastSyncAt || now - m.calendarConnection.lastSyncAt.getTime() > SYNC_THROTTLE_MS))
    .map((m) => m.id);
  if (staleMemberIds.length > 0) {
    await Promise.all(staleMemberIds.map((id) => syncTeamMemberCalendar(id)));
  }

  const hasDate = !!params.date;
  const tz = params.tz || "America/New_York";
  const fromStr = params.from || "09:00";
  const toStr = params.to || "17:00";
  const selectedIds = params.members ? new Set(params.members.split(",")) : null;

  let day: Interval | null = null;
  let searchStart: Date | null = null;
  let searchEnd: Date | null = null;
  const blocksByMember = new Map<string, Interval[]>();
  let freeSlots: Interval[] = [];

  if (hasDate) {
    day = dayBoundsInTz(params.date!, tz);
    searchStart = zonedDateTime(params.date!, fromStr, tz);
    searchEnd = zonedDateTime(params.date!, toStr, tz);

    const dayBlocks = await prisma.teamMemberBusyBlock.findMany({
      where: { teamMemberId: { in: members.map((m) => m.id) }, startTime: { lt: day.end }, endTime: { gt: day.start } },
      select: { teamMemberId: true, startTime: true, endTime: true },
    });
    for (const block of dayBlocks) {
      const list = blocksByMember.get(block.teamMemberId) ?? [];
      list.push({ start: block.startTime, end: block.endTime });
      blocksByMember.set(block.teamMemberId, list);
    }

    const consideredBusy = members
      .filter((m) => !!m.calendarConnection && (selectedIds ? selectedIds.has(m.id) : true))
      .flatMap((m) => blocksByMember.get(m.id) ?? []);
    freeSlots = computeFreeSlots(searchStart, searchEnd, consideredBusy, 30).slice(0, 6);
  }

  const consideredConnectedCount = members.filter(
    (m) => !!m.calendarConnection && (selectedIds ? selectedIds.has(m.id) : true),
  ).length;

  return (
    <div className="mt-4 max-w-2xl">
      <p className="text-muted-foreground">
        Pick a date to see suggested times everyone's free, or narrow it down manually.
      </p>

      <div className="mt-4 space-y-3">
        <AvailabilityFilters />
        <MemberFilter members={members} />
      </div>

      {hasDate && searchStart && searchEnd ? (
        <div className="mt-4 rounded-lg border p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarClock className="size-4" />
            Suggested times everyone's free
          </p>
          {consideredConnectedCount === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              None of the selected people have connected their Google Calendar yet.
            </p>
          ) : freeSlots.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No common free slot found between {fromStr} and {toStr} for the selected people.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {freeSlots.map((slot, i) => (
                <Link
                  key={i}
                  href={`/team?${new URLSearchParams({
                    tab: "availability",
                    date: params.date!,
                    tz,
                    ...(params.members ? { members: params.members } : {}),
                    from: hhmmInTz(slot.start, tz),
                    to: hhmmInTz(slot.end, tz),
                  }).toString()}`}
                  className="rounded-full border border-status-success-foreground/30 bg-status-success/20 px-2.5 py-1 text-xs font-medium text-status-success-foreground hover:bg-status-success/30"
                >
                  {formatTimeInTz(slot.start, tz)} – {formatTimeInTz(slot.end, tz)}
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-4 divide-y rounded-lg border">
        {members.length === 0 ? (
          <EmptyState icon={Users} title="No team members yet." />
        ) : (
          members.map((member) => {
            const connected = !!member.calendarConnection;
            const theirBlocks = blocksByMember.get(member.id) ?? [];
            const busyInWindow = hasDate && connected && theirBlocks.some((b) => b.start < searchEnd! && b.end > searchStart!);
            const isMe = member.id === currentUserId;

            let pill: { tone: "success" | "danger" | "neutral"; label: string };
            if (!hasDate) pill = { tone: "neutral", label: connected ? "Connected" : "Not connected" };
            else if (!connected) pill = { tone: "neutral", label: "Not connected" };
            else if (busyInWindow) pill = { tone: "danger", label: "Busy" };
            else pill = { tone: "success", label: "Available" };

            const row = (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
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
                      className="text-xs text-primary underline-offset-4 hover:underline"
                    >
                      Connect
                    </Link>
                  ) : null}
                  <StatusPillBase tone={pill.tone} label={pill.label} />
                </div>
              </div>
            );

            if (!hasDate || !connected || !day) {
              return <div key={member.id}>{row}</div>;
            }

            return (
              <details key={member.id} className="group">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{row}</summary>
                <div className="px-4 pb-3">
                  <AvailabilityDayTimeline day={day} busyBlocks={theirBlocks} />
                </div>
              </details>
            );
          })
        )}
      </div>

      {!hasDate ? <p className="mt-4 text-sm text-muted-foreground">Pick a date above to see who's free.</p> : null}
    </div>
  );
}
